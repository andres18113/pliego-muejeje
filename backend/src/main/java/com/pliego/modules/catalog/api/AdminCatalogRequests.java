package com.pliego.modules.catalog.api;

import java.time.LocalDate;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Request shapes for the contract's ADMIN catalog endpoints. */
public final class AdminCatalogRequests {
    private AdminCatalogRequests() { }

    public record Status(@NotBlank(message = "El estado no puede estar vacío.")
            @Pattern(regexp = "ACTIVE|INACTIVE", message = "El estado debe ser ACTIVE o INACTIVE.") String state) { }

    public record Author(@NotBlank(message = "El nombre del autor no puede estar vacío.")
            @Size(max = 200, message = "El nombre del autor excede la longitud permitida.") String name,
            @Size(max = 5000, message = "La biografía excede la longitud permitida.") String biography) { }
    public record Publisher(@NotBlank(message = "El nombre de la editorial no puede estar vacío.")
            @Size(max = 200, message = "El nombre de la editorial excede la longitud permitida.") String name,
            @Size(max = 2000, message = "La descripción excede la longitud permitida.") String description) { }
    public record Category(@NotBlank(message = "El nombre de la categoría no puede estar vacío.")
            @Size(max = 120, message = "El nombre de la categoría excede la longitud permitida.") String name,
            @NotBlank(message = "El slug de la categoría no puede estar vacío.")
            @Size(max = 140, message = "El slug de la categoría excede la longitud permitida.") String slug,
            @Size(max = 1000, message = "La descripción excede la longitud permitida.") String description,
            @Pattern(regexp = "[1-9][0-9]*", message = "El identificador de la categoría padre no es válido.") String parentCategoryId) { }

    public record Book(@NotBlank(message = "El título del libro no puede estar vacío.")
            @Size(max = 300, message = "El título del libro excede la longitud permitida.") String title,
            @Size(max = 300, message = "El subtítulo excede la longitud permitida.") String subtitle,
            @Size(max = 10000, message = "La sinopsis excede la longitud permitida.") String synopsis,
            @NotNull(message = "La lista de autores es obligatoria.") List<@Valid AuthorAssignment> authors,
            @NotNull(message = "La lista de categorías es obligatoria.")
            List<@Pattern(regexp = "[1-9][0-9]*", message = "Un identificador de categoría no es válido.") String> categoryIds) { }
    public record AuthorAssignment(@NotBlank(message = "El identificador del autor no puede estar vacío.")
            @Pattern(regexp = "[1-9][0-9]*", message = "El identificador del autor no es válido.") String authorId,
            @NotNull(message = "El orden del autor es obligatorio.") Integer order) { }

    public record EditionCreate(@NotBlank(message = "El identificador del libro no puede estar vacío.")
            @Pattern(regexp = "[1-9][0-9]*", message = "El identificador del libro no es válido.") String bookId,
            @NotBlank(message = "El identificador de la editorial no puede estar vacío.")
            @Pattern(regexp = "[1-9][0-9]*", message = "El identificador de la editorial no es válido.") String publisherId,
            @NotBlank(message = "El SKU no puede estar vacío.") String sku,
            @Pattern(regexp = "(?:[0-9]{13})?", message = "El ISBN debe contener 13 dígitos.") String isbn13,
            @NotBlank(message = "El idioma no puede estar vacío.")
            @Pattern(regexp = "(?i)[a-z]{2,3}", message = "El idioma no tiene un formato válido.") String language,
            @NotBlank(message = "El formato no puede estar vacío.")
            @Pattern(regexp = "PAPERBACK|HARDCOVER", message = "El formato debe ser PAPERBACK o HARDCOVER.") String format,
            @NotNull(message = "El número de páginas es obligatorio.") Integer pageCount, LocalDate publicationDate,
            @NotBlank(message = "El precio no puede estar vacío.")
            @Pattern(regexp = "[0-9]{1,9}\\.[0-9]{2}", message = "El precio debe tener dos posiciones decimales.") String price,
            @Size(max = 2048, message = "La URL de portada excede la longitud permitida.") String coverUrl,
            @Size(max = 32, message = "La licencia de portada excede la longitud permitida.") String coverLicense,
            @Size(max = 2048, message = "La URL de origen excede la longitud permitida.") String coverSourceUrl,
            @Size(max = 500, message = "La atribución de portada excede la longitud permitida.") String coverAttribution) { }

    /** bookId and sku are deliberately absent because they are immutable after creation. */
    public record EditionUpdate(@NotBlank(message = "El identificador de la editorial no puede estar vacío.")
            @Pattern(regexp = "[1-9][0-9]*", message = "El identificador de la editorial no es válido.") String publisherId,
            @Pattern(regexp = "(?:[0-9]{13})?", message = "El ISBN debe contener 13 dígitos.") String isbn13,
            @NotBlank(message = "El idioma no puede estar vacío.")
            @Pattern(regexp = "(?i)[a-z]{2,3}", message = "El idioma no tiene un formato válido.") String language,
            @NotBlank(message = "El formato no puede estar vacío.")
            @Pattern(regexp = "PAPERBACK|HARDCOVER", message = "El formato debe ser PAPERBACK o HARDCOVER.") String format,
            @NotNull(message = "El número de páginas es obligatorio.") Integer pageCount, LocalDate publicationDate,
            @NotBlank(message = "El precio no puede estar vacío.")
            @Pattern(regexp = "[0-9]{1,9}\\.[0-9]{2}", message = "El precio debe tener dos posiciones decimales.") String price,
            @Size(max = 2048, message = "La URL de portada excede la longitud permitida.") String coverUrl,
            @Size(max = 32, message = "La licencia de portada excede la longitud permitida.") String coverLicense,
            @Size(max = 2048, message = "La URL de origen excede la longitud permitida.") String coverSourceUrl,
            @Size(max = 500, message = "La atribución de portada excede la longitud permitida.") String coverAttribution) { }
}
