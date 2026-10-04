"""Conservative, deterministic cover normalization. No generated fill or network access."""
from __future__ import annotations

import hashlib
import io
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms, ImageFilter, ImageOps

TARGET_W, TARGET_H = 720, 1080
MAX_BYTES = 204800
QUALITIES = (86, 84, 82, 80)
MAX_UPSCALE = 4.0
MAX_CROP = 0.10
MAX_TRIM = 0.05
STATES = ("ACEPTADO", "METADATOS_PENDIENTES", "REVISION_ENCUADRE", "FUENTE_INSUFICIENTE",
          "PESO_EXCEDIDO", "ARCHIVO_INVALIDO")
SRGB = ImageCms.createProfile("sRGB")
LAB = ImageCms.createProfile("LAB")


class CoverRejected(ValueError):
    def __init__(self, status: str, reason: str, details: dict):
        self.details = {**details, "status": status, "reason": reason}
        super().__init__(reason)


def initial_report() -> dict:
    return {"original_size": None, "oriented_size": None, "clean_size": None,
            "trim": {"left": 0, "top": 0, "right": 0, "bottom": 0}, "crop": None,
            "upscale_factor": None, "normalized_size": None, "quality": None, "bytes": None,
            "sha256": None, "padded": False, "status": None, "reason": None}


def size(image: Image.Image) -> dict:
    return {"width": image.width, "height": image.height}


def _lab(image: Image.Image) -> np.ndarray:
    converted = ImageCms.profileToProfile(image, SRGB, LAB, outputMode="LAB")
    result = np.asarray(converted, dtype=np.float32).copy()
    result[:, :, 0] *= 100 / 255
    result[:, :, 1:] -= 128
    return result


def _bands(image: Image.Image) -> dict[str, int]:
    lab = _lab(image)
    result = {}
    for side in ("left", "top", "right", "bottom"):
        data = lab if side in {"top", "bottom"} else lab.transpose(1, 0, 2)
        if side in {"right", "bottom"}:
            data = data[::-1]
        color = np.median(data[0], axis=0)
        depth = 0
        for line in data[:max(1, int(len(data) * .20))]:
            if np.mean(np.linalg.norm(line - color, axis=1) <= 6) < .99:
                break
            depth += 1
        result[side] = depth
    # Useful edge length excludes perpendicular candidate bands/capture corners.
    confirmed = {}
    for side, depth in result.items():
        data = lab if side in {"top", "bottom"} else lab.transpose(1, 0, 2)
        if side in {"right", "bottom"}:
            data = data[::-1]
        lo, hi = ((result["left"], result["right"]) if side in {"top", "bottom"}
                  else (result["top"], result["bottom"]))
        line = data[depth, lo:len(data[0]) - hi] if depth < len(data) else np.empty((0, 3))
        color = np.median(data[0], axis=0)
        confirmed[side] = depth if depth and len(line) and np.mean(np.linalg.norm(line - color, axis=1) >= 12) >= .95 else 0
    return confirmed



def _suspect_perspective(image: Image.Image) -> bool:
    """Recognize a large sloping jacket against a uniform capture background.

    Only straight, sustained boundaries count; artwork/letter contrast alone does not.
    """
    lab = _lab(image)
    corners = np.concatenate([lab[:3,:3].reshape(-1,3),lab[:3,-3:].reshape(-1,3),
                              lab[-3:,:3].reshape(-1,3),lab[-3:,-3:].reshape(-1,3)])
    color = np.median(corners,axis=0)
    if np.mean(np.linalg.norm(corners-color,axis=1) <= 6) < .99:
        return False
    mask = np.linalg.norm(lab-color,axis=2) >= 12
    if not .50 <= mask.mean() <= .90:
        return False
    rows = np.where(mask.mean(axis=1) >= .35)[0]
    if len(rows) < image.height*.5:
        return False
    left = np.argmax(mask[rows],axis=1)
    right = image.width-1-np.argmax(mask[rows,::-1],axis=1)
    for boundary in (left,right):
        slope, intercept = np.polyfit(rows,boundary,1)
        residual = np.abs(boundary-(slope*rows+intercept))
        if abs(slope) >= .03 and np.mean(residual <= 2) >= .95:
            return True
    return False

def _ink_regions(image: Image.Image) -> list[tuple[float, float, float, float]]:
    """Conservative contrast components: glyph-size marks and edge logos, not semantic OCR.

    Explicit protectedRegions supplement this detector for ambiguous artwork.
    Work on a bounded inspection copy; never alter the output image.
    """
    scale = min(1., 512 / max(image.size))
    inspected = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))))
    edge = np.asarray(inspected.convert("L").filter(ImageFilter.FIND_EDGES)) > 48
    edge[[0, -1], :] = False
    edge[:, [0, -1]] = False
    height, width = edge.shape
    seen = np.zeros_like(edge)
    boxes = []
    for y, x in zip(*np.where(edge)):
        if seen[y, x]:
            continue
        seen[y, x] = True
        queue = deque([(int(x), int(y))])
        xs, ys = [], []
        while queue:
            cx, cy = queue.popleft()
            xs.append(cx); ys.append(cy)
            for nx, ny in ((cx-1,cy),(cx+1,cy),(cx,cy-1),(cx,cy+1)):
                if 0 <= nx < width and 0 <= ny < height and edge[ny,nx] and not seen[ny,nx]:
                    seen[ny,nx] = True
                    queue.append((nx,ny))
        x0, x1, y0, y1 = min(xs), max(xs)+1, min(ys), max(ys)+1
        bw, bh = x1-x0, y1-y0
        # Small isolated high-contrast marks can be letters or logos. Large artwork
        # is not classified as text solely because it contains contrast.
        if len(xs) >= 3 and 2 <= bw <= width*.35 and 3 <= bh <= height*.20:
            boxes.append((x0/scale,y0/scale,x1/scale,y1/scale))
    return boxes


def _contains(box, regions, width, height, guard=2) -> bool:
    left, top, right, bottom = box
    for x0, y0, x1, y1 in regions:
        if (x0 < left + (guard if left > 0 else 0)
                or y0 < top + (guard if top > 0 else 0)
                or x1 > right - (guard if right < width else 0)
                or y1 > bottom - (guard if bottom < height else 0)):
            return False
    return True


def normalize_image(source: Path, override: dict | None = None) -> tuple[Image.Image, dict]:
    details = initial_report()
    if override is not None and not isinstance(override, dict):
        raise CoverRejected("REVISION_ENCUADRE", "Las opciones de normalización deben ser un objeto.", details)
    override = override or {}
    try:
        with Image.open(source) as opened:
            details["original_size"] = size(opened)
            if getattr(opened, "n_frames", 1) != 1 or opened.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Se requiere JPG, PNG o WebP estático.")
            opened.load()
            image = ImageOps.exif_transpose(opened)
            details["oriented_size"] = size(image)
            width, height = image.size
            alpha_box = (0, 0, width, height)
            if "A" in image.getbands() or "transparency" in image.info:
                rgba = image.convert("RGBA")
                alpha_box = rgba.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
                if alpha_box is None:
                    raise ValueError("La imagen es totalmente transparente.")
                image = rgba.crop(alpha_box)
                if image.getchannel("A").getextrema() != (255, 255):
                    raise CoverRejected("REVISION_ENCUADRE", "Transparencia dentro de la cubierta; no se añadirá un fondo.", details)
            profile = image.info.get("icc_profile")
            if profile:
                image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(profile)), SRGB, outputMode="RGB")
            else:
                image = image.convert("RGB")
            image.info.clear()
    except CoverRejected:
        raise
    except (OSError, ValueError, Image.DecompressionBombError, ImageCms.PyCMSError) as error:
        raise CoverRejected("ARCHIVO_INVALIDO", str(error), details) from error

    alpha_left, alpha_top, alpha_right, alpha_bottom = alpha_box
    details["trim"] = {"left": alpha_left, "top": alpha_top, "right": width-alpha_right, "bottom": height-alpha_bottom}
    details["clean_size"] = size(image)
    if any(details["trim"][side] / (width if side in {"left","right"} else height) > MAX_TRIM
           for side in details["trim"]):
        raise CoverRejected("REVISION_ENCUADRE", "El exterior transparente supera 5 % por lado.", details)
    explicit = override.get("protectedRegions", [])
    regions = _ink_regions(image)
    if not isinstance(explicit, list):
        raise CoverRejected("REVISION_ENCUADRE", "protectedRegions debe ser una lista.", details)
    for box in explicit:
        if (not isinstance(box, (list,tuple)) or len(box) != 4
                or any(type(v) not in {int,float} or not np.isfinite(v) for v in box)
                or not 0 <= box[0] < box[2] <= width or not 0 <= box[1] < box[3] <= height):
            raise CoverRejected("REVISION_ENCUADRE", "protectedRegions contiene coordenadas inválidas.", details)
        regions.append((box[0]-alpha_left,box[1]-alpha_top,box[2]-alpha_left,box[3]-alpha_top))
    if _suspect_perspective(image):
        raise CoverRejected("REVISION_ENCUADRE", "Cubierta con perspectiva sobre un fondo de captura; no se deformará.", details)
    candidates = _bands(image)
    protected_sides = override.get("editorialBorders", [])
    if not isinstance(protected_sides, list) or any(s not in candidates for s in protected_sides):
        raise CoverRejected("REVISION_ENCUADRE", "editorialBorders contiene lados inválidos.", details)
    if all(candidates.values()) and set(protected_sides) != set(candidates):
        raise CoverRejected("REVISION_ENCUADRE", "Marco uniforme en cuatro lados: exterior y borde editorial son ambiguos.", details)
    for side in protected_sides:
        candidates[side] = 0
    crop = (candidates["left"],candidates["top"],image.width-candidates["right"],image.height-candidates["bottom"])
    for side in candidates:
        details["trim"][side] += candidates[side]
    if any(details["trim"][side] / (width if side in {"left","right"} else height) > MAX_TRIM
           for side in candidates):
        raise CoverRejected("REVISION_ENCUADRE", "El margen exterior supera 5 % por lado.", details)
    if not _contains(crop, regions, image.width, image.height):
        raise CoverRejected("REVISION_ENCUADRE", "El trim afectaría marcas protegidas.", details)
    regions = [(a-crop[0],b-crop[1],c-crop[0],d-crop[1]) for a,b,c,d in regions]
    image = image.crop(crop)
    details["clean_size"] = size(image)
    w, h = image.size
    ratio = w/h
    retained = min(ratio/(2/3), (2/3)/ratio)
    fraction = 1-retained
    scale = max(TARGET_W/w, TARGET_H/h)
    details["upscale_factor"] = round(scale, 6)
    details["upscaled"] = scale > 1
    details["aspect_crop_fraction"] = round(fraction, 6)
    if scale > MAX_UPSCALE + 1e-9:
        raise CoverRejected("FUENTE_INSUFICIENTE", "La ampliación necesaria supera 4×.", details)
    if fraction > MAX_CROP + 1e-9 or override.get("mode") == "contain":
        raise CoverRejected("REVISION_ENCUADRE", "La proporción requiere un recorte excesivo o contain; no se añadirá padding.", details)
    bw, bh = min(w,h*2/3), min(h,w*3/2)
    cx, cy = (w-bw)/2, (h-bh)/2
    raw_focal = override.get("focalX" if ratio > 2/3 else "focalY", .5)
    if type(raw_focal) not in {int, float}:
        raise CoverRejected("REVISION_ENCUADRE", "El centro solicitado debe ser numérico.", details)
    focal = float(raw_focal)
    if not np.isfinite(focal) or abs(focal-.5) > .05:
        raise CoverRejected("REVISION_ENCUADRE", "El centro solicitado supera el desplazamiento permitido.", details)
    offsets = [0., *sorted(np.linspace(-.05,.05,41), key=abs)]
    boxes = []
    for offset in offsets:
        x = min(w-bw,max(0,cx+(focal-.5+offset)*w)) if ratio > 2/3 else cx
        y = min(h-bh,max(0,cy+(focal-.5+offset)*h)) if ratio < 2/3 else cy
        box = (x,y,x+bw,y+bh)
        # The final displacement, including an override, stays bounded.
        if abs(x-cx) <= .05*w+1e-9 and abs(y-cy) <= .05*h+1e-9:
            boxes.append(box)
    def keeps_editorial_borders(box):
        edges = {"left":box[0], "top":box[1], "right":w-box[2], "bottom":h-box[3]}
        return all(abs(edges[side]) <= 1e-9 for side in protected_sides)
    chosen = next((b for b in boxes if _contains(b, regions, w, h) and keeps_editorial_borders(b)), None)
    if chosen is None:
        raise CoverRejected("REVISION_ENCUADRE", "No existe un crop seguro para las marcas protegidas.", details)
    details["crop"] = {"box": list(chosen), "fraction": round(fraction,6),
                       "shift_x": round((chosen[0]-cx)/w,6), "shift_y": round((chosen[1]-cy)/h,6)}
    output = image.resize((TARGET_W,TARGET_H), Image.Resampling.LANCZOS, box=chosen)
    output.info.clear()
    details.update(normalized_size=size(output), status="ACEPTADO", reason=None,
                   protected_regions=[list(r) for r in regions], mode="CROP_OR_EXACT")
    return output, details


def encode_webp(image: Image.Image, details: dict) -> tuple[bytes, dict]:
    for quality in QUALITIES:
        stream = io.BytesIO()
        image.save(stream, format="WEBP", method=6, quality=quality)
        data = stream.getvalue()
        result = {**details, "quality": quality, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        if len(data) <= MAX_BYTES:
            return data, result
    raise CoverRejected("PESO_EXCEDIDO", "Ninguna calidad permitida cumple 204800 bytes.", result)


def normalize_file(source: Path, override: dict | None = None) -> tuple[bytes, dict]:
    image, details = normalize_image(source, override)
    return encode_webp(image, details)
