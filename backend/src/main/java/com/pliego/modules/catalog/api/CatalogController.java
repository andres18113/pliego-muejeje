package com.pliego.modules.catalog.api;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.format.DateTimeFormatter;
import java.util.List;

import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.PageResponse;
import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.catalog.application.CatalogEditionDetail;
import com.pliego.modules.catalog.application.CatalogEditionSummary;
import com.pliego.modules.catalog.application.CatalogQuery;
import com.pliego.modules.catalog.application.CatalogSearchPage;
import com.pliego.modules.catalog.application.CatalogService;
import com.pliego.modules.catalog.application.PublicCatalogFilterOptions;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

@Validated
@RestController
@RequestMapping(path = "/api/v1/catalog", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Catálogo público", description = "Navegación de categorías y búsqueda/consulta de ediciones públicas.")
public class CatalogController {

    private static final DateTimeFormatter CONTRACT_DATE = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final String CATEGORY_SLUG = "(?i)[a-z0-9]+(?:-[a-z0-9]+)*";

    private final CatalogService catalogService;

    public CatalogController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @GetMapping("/editions")
    @Operation(summary = "Buscar ediciones publicables", description = "Filtra y pagina el catálogo público. "
            + "El parámetro «que» busca automáticamente por ISBN-13 exacto o por coincidencias parciales de título y autor. "
            + "Un slug de categoría desconocido devuelve una página vacía; una categoría inactiva devuelve 409.")
    @ApiResponse(responseCode = "200", description = "Página del catálogo",
            content = @Content(schema = @Schema(implementation = CatalogEditionSearchResponse.class)))
    @ApiResponse(responseCode = "400", description = "Filtros inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "409", description = "La categoría está inactiva", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public PageResponse<CatalogEditionSummaryResponse> search(
            @Parameter(description = "Consulta global por ISBN-13, título o autor; tiene prioridad sobre title, author e isbn13")
            @RequestParam(name = "que", required = false)
            @Size(max = 140, message = "La búsqueda no puede superar 140 caracteres.") String query,
            @Parameter(description = "Texto parcial del título") @RequestParam(required = false) String title,
            @Parameter(description = "Texto parcial del autor") @RequestParam(required = false) String author,
            @RequestParam(required = false) @Pattern(regexp = "[0-9]{13}") String isbn13,
            @RequestParam(required = false) @Size(max = 140) @Pattern(regexp = CATEGORY_SLUG) String category,
            @RequestParam(required = false) @DecimalMin("0.00") BigDecimal minPrice,
            @RequestParam(required = false) @DecimalMin("0.00") BigDecimal maxPrice,
            @RequestParam(required = false) @Pattern(regexp = "(?i)[a-z]{2,3}") String language,
            @RequestParam(required = false) @Pattern(regexp = "PAPERBACK|HARDCOVER|EBOOK|AUDIOBOOK",
                    message = "El formato debe ser PAPERBACK, HARDCOVER, EBOOK o AUDIOBOOK.") String format,
            @RequestParam(defaultValue = "TITLE_ASC") @Pattern(regexp = "TITLE_ASC|PRICE_ASC|PRICE_DESC") String sort,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @jakarta.validation.constraints.Max(50) int pageSize) {
        CatalogQuery catalogQuery = new CatalogQuery(query, title, author, isbn13, category, minPrice, maxPrice,
                language, format, sort, page, pageSize);
        CatalogSearchPage result = catalogService.search(catalogQuery);
        List<CatalogEditionSummaryResponse> items = result.items().stream()
                .map(CatalogController::toSummaryResponse).toList();
        return new PageResponse<>(items, page, pageSize, Long.toString(result.totalCount()));
    }

    @GetMapping("/offers")
    @Operation(operationId = "offers", summary = "Buscar ofertas vigentes",
            description = "Pagina únicamente ediciones publicables con una oferta vigente; los precios y descuentos los calcula PostgreSQL.")
    @ApiResponse(responseCode = "200", description = "Página de ofertas",
            content = @Content(schema = @Schema(implementation = CatalogEditionSearchResponse.class)))
    @ApiResponse(responseCode = "400", description = "Filtros inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public PageResponse<CatalogEditionSummaryResponse> offers(
            @RequestParam(required = false) @Pattern(regexp = "PAPERBACK|HARDCOVER|EBOOK|AUDIOBOOK",
                    message = "El formato debe ser PAPERBACK, HARDCOVER, EBOOK o AUDIOBOOK.") String format,
            @RequestParam(required = false) @Pattern(regexp = "PHYSICAL|EBOOK|AUDIOBOOK", message = "El tipo de producto debe ser PHYSICAL, EBOOK o AUDIOBOOK.") String productType,
            @RequestParam(required = false) @Size(max = 140) @Pattern(regexp = CATEGORY_SLUG) String category,
            @RequestParam(defaultValue = "RELEVANCE") @Pattern(regexp = "RELEVANCE|ENDING_SOON|PRICE_ASC|PRICE_DESC") String sort,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @jakarta.validation.constraints.Max(50) int pageSize) {
        CatalogSearchPage result = catalogService.search(new CatalogQuery(null, null, null, null, category,
                null, null, null, format, sort, page, pageSize, true, productType));
        return new PageResponse<>(result.items().stream().map(CatalogController::toSummaryResponse).toList(),
                page, pageSize, Long.toString(result.totalCount()));
    }

    @GetMapping("/offers/filter-options")
    @Operation(operationId = "offersFilterOptions", summary = "Consultar filtros aplicables a ofertas vigentes",
            description = "Tipos de producto, categorías, recuentos, ordenaciones y configuración temporal definidos por PostgreSQL.")
    @ApiResponse(responseCode = "200", description = "Filtros y configuración temporal de ofertas")
    public com.pliego.modules.catalog.application.OffersFilterOptions offersFilterOptions() {
        return catalogService.getOffersFilterOptions();
    }

    @GetMapping("/editions/{editionId}")
    @Operation(summary = "Consultar una edición publicable")
    @ApiResponse(responseCode = "200", description = "Detalle de la edición", content = @Content(schema = @Schema(implementation = CatalogEditionDetailResponse.class)))
    @ApiResponse(responseCode = "404", description = "Edición no disponible", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public CatalogEditionDetailResponse getEdition(@PathVariable @Positive long editionId) {
        return toDetailResponse(catalogService.getPublicEdition(editionId));
    }

    @GetMapping("/categories")
    @Operation(summary = "Listar categorías del catálogo público",
            description = "Devuelve categorías activas con ediciones publicables y su jerarquía de hasta dos niveles.")
    @ApiResponse(responseCode = "200", description = "Categorías disponibles para navegar el catálogo",
            content = @Content(schema = @Schema(implementation = CatalogCategoryListResponse.class)))
    public CatalogCategoryListResponse listCategories() {
        return new CatalogCategoryListResponse(catalogService.listPublicCategories().stream()
                .map(category -> new CatalogCategoryListResponse.Category(category.slug(), category.name(),
                        category.parentSlug()))
                .toList());
    }

    @GetMapping("/filter-options")
    @Operation(summary = "Consultar opciones de filtros del catálogo público",
            description = "Devuelve idiomas, formatos y límites de precio de todas las ediciones publicables actuales.")
    @ApiResponse(responseCode = "200", description = "Opciones disponibles para los filtros del catálogo",
            content = @Content(schema = @Schema(implementation = PublicCatalogFilterOptionsResponse.class)))
    public PublicCatalogFilterOptionsResponse filterOptions() {
        PublicCatalogFilterOptions options = catalogService.getPublicFilterOptions();
        return new PublicCatalogFilterOptionsResponse(options.languages(), options.formats(),
                options.minimumPrice() == null ? null : money(options.minimumPrice()),
                options.maximumPrice() == null ? null : money(options.maximumPrice()));
    }

    private static CatalogEditionSummaryResponse toSummaryResponse(CatalogEditionSummary edition) {
        return new CatalogEditionSummaryResponse(edition.editionId(), edition.bookId(), edition.title(),
                edition.authors(), edition.publisher(), edition.isbn13(), money(edition.price()),
                edition.coverUrl(), edition.coverLicense(), edition.coverAttribution(), edition.format(),
                edition.language(), edition.available(), edition.ebookFileFormat(), edition.audioDurationSeconds(), edition.narrators(), toOfferResponse(edition.offer()));
    }

    private static CatalogEditionDetailResponse toDetailResponse(CatalogEditionDetail edition) {
        return new CatalogEditionDetailResponse(edition.editionId(), edition.bookId(), edition.title(),
                edition.subtitle(), edition.synopsis(),
                edition.authors().stream()
                        .map(author -> new CatalogEditionDetailResponse.Author(author.authorId(), author.name(),
                                author.order())).toList(),
                edition.categories().stream()
                        .map(category -> new CatalogEditionDetailResponse.Category(category.categoryId(),
                                category.name(), category.slug(), category.parentCategoryId())).toList(),
                new CatalogEditionDetailResponse.Publisher(edition.publisher().publisherId(),
                        edition.publisher().name()),
                edition.isbn13(), edition.sku(), edition.language(), edition.format(), edition.pageCount(),
                edition.publicationDate() == null ? null : CONTRACT_DATE.format(edition.publicationDate()),
                money(edition.price()), edition.coverUrl(), edition.coverLicense(), edition.coverSourceUrl(),
                edition.coverAttribution(), edition.available(), edition.ebookFileFormat(), edition.audioDurationSeconds(), edition.narrators(), toOfferResponse(edition.offer()));
    }

    private static CatalogOfferResponse toOfferResponse(com.pliego.modules.catalog.application.CatalogOffer offer) {
        return offer == null ? null : new CatalogOfferResponse(offer.offerId(), money(offer.originalPrice()),
                money(offer.discountAmount()), DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(offer.startsAt().atZone(java.time.ZoneId.of("America/Guayaquil"))),
                DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(offer.endsAt().atZone(java.time.ZoneId.of("America/Guayaquil"))),
                offer.daysRemaining(), offer.endingSoon(), offer.offerCopy(), offer.terms(), money(offer.effectivePrice()), money(offer.discountAmount()), money(offer.savingsPercent()));
    }

    private static String money(BigDecimal amount) {
        return amount.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
    }
}
