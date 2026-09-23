package com.pliego.modules.catalog.api;

import java.math.RoundingMode;
import java.time.LocalDate;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.PageResponse;
import com.pliego.foundation.web.ProblemResponse;
import static com.pliego.modules.catalog.application.AdminCatalogModels.*;
import com.pliego.modules.catalog.api.AdminCatalogRequests.AuthorAssignment;
import com.pliego.modules.catalog.api.AdminCatalogRequests.EditionCreate;
import com.pliego.modules.catalog.api.AdminCatalogRequests.EditionUpdate;
import com.pliego.modules.catalog.application.AdminCatalogService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;

@Validated
@RestController
@RequestMapping(path = "/api/v1/admin", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Administración de catálogo", description = "Gestión administrativa de autores, editoriales, categorías, libros y ediciones.")
@SecurityRequirement(name = "bearerJwt")
public class AdminCatalogController {

    private static final String STATE_PATTERN = "ACTIVE|INACTIVE";
    private final AdminCatalogService service;

    public AdminCatalogController(AdminCatalogService service) { this.service = service; }

    @GetMapping("/authors")
    @Operation(summary = "Buscar autores")
    @ApiResponse(responseCode = "200", description = "Página de autores")
    @ApiResponse(responseCode = "400", description = "Filtros inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public PageResponse<AdminCatalogResponses.Author> searchAuthors(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) @Pattern(regexp = STATE_PATTERN) String state,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        var result = service.searchAuthors(actorId(jwt), new Search(query, state, page, pageSize));
        return page(result, page, pageSize, row -> new AdminCatalogResponses.Author(row.authorId(), row.name(),
                row.biography(), row.state(), row.createdAt(), row.updatedAt()));
    }

    @PostMapping(path = "/authors", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Crear autor")
    @ApiResponse(responseCode = "201", description = "Autor creado")
    public ResponseEntity<AdminCatalogResponses.AuthorCreated> createAuthor(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody AdminCatalogRequests.Author request) {
        long id = service.createAuthor(actorId(jwt), new AuthorData(request.name(), request.biography()));
        return ResponseEntity.status(HttpStatus.CREATED).body(new AdminCatalogResponses.AuthorCreated(Long.toString(id)));
    }

    @PutMapping(path = "/authors/{authorId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Reemplazar autor")
    public ResponseEntity<Void> updateAuthor(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long authorId,
            @Valid @RequestBody AdminCatalogRequests.Author request) {
        service.updateAuthor(actorId(jwt), authorId, new AuthorData(request.name(), request.biography()));
        return ResponseEntity.noContent().build();
    }

    @PutMapping(path = "/authors/{authorId}/status", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> authorStatus(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long authorId,
            @Valid @RequestBody AdminCatalogRequests.Status request) {
        service.setAuthorStatus(actorId(jwt), authorId, request.state()); return ResponseEntity.noContent().build();
    }

    @GetMapping("/publishers")
    @Operation(summary = "Buscar editoriales")
    public PageResponse<AdminCatalogResponses.Publisher> searchPublishers(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) @Pattern(regexp = STATE_PATTERN) String state,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        var result = service.searchPublishers(actorId(jwt), new Search(query, state, page, pageSize));
        return page(result, page, pageSize, row -> new AdminCatalogResponses.Publisher(row.publisherId(), row.name(),
                row.description(), row.state(), row.createdAt(), row.updatedAt()));
    }

    @PostMapping(path = "/publishers", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Crear editorial")
    public ResponseEntity<AdminCatalogResponses.PublisherCreated> createPublisher(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody AdminCatalogRequests.Publisher request) {
        long id = service.createPublisher(actorId(jwt), new PublisherData(request.name(), request.description()));
        return ResponseEntity.status(HttpStatus.CREATED).body(new AdminCatalogResponses.PublisherCreated(Long.toString(id)));
    }

    @PutMapping(path = "/publishers/{publisherId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> updatePublisher(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long publisherId,
            @Valid @RequestBody AdminCatalogRequests.Publisher request) {
        service.updatePublisher(actorId(jwt), publisherId, new PublisherData(request.name(), request.description()));
        return ResponseEntity.noContent().build();
    }

    @PutMapping(path = "/publishers/{publisherId}/status", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> publisherStatus(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long publisherId,
            @Valid @RequestBody AdminCatalogRequests.Status request) {
        service.setPublisherStatus(actorId(jwt), publisherId, request.state()); return ResponseEntity.noContent().build();
    }

    @GetMapping("/categories")
    @Operation(summary = "Buscar categorías")
    public PageResponse<AdminCatalogResponses.Category> searchCategories(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) @Pattern(regexp = STATE_PATTERN) String state,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        var result = service.searchCategories(actorId(jwt), new Search(query, state, page, pageSize));
        return page(result, page, pageSize, row -> new AdminCatalogResponses.Category(row.categoryId(),
                row.parentCategoryId(), row.parentName(), row.name(), row.slug(), row.description(), row.state(),
                row.createdAt(), row.updatedAt()));
    }

    @PostMapping(path = "/categories", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Crear categoría")
    public ResponseEntity<AdminCatalogResponses.CategoryCreated> createCategory(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody AdminCatalogRequests.Category request) {
        long id = service.createCategory(actorId(jwt), categoryData(request));
        return ResponseEntity.status(HttpStatus.CREATED).body(new AdminCatalogResponses.CategoryCreated(Long.toString(id)));
    }

    @PutMapping(path = "/categories/{categoryId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> updateCategory(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long categoryId,
            @Valid @RequestBody AdminCatalogRequests.Category request) {
        service.updateCategory(actorId(jwt), categoryId, categoryData(request)); return ResponseEntity.noContent().build();
    }

    @PutMapping(path = "/categories/{categoryId}/status", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> categoryStatus(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long categoryId,
            @Valid @RequestBody AdminCatalogRequests.Status request) {
        service.setCategoryStatus(actorId(jwt), categoryId, request.state()); return ResponseEntity.noContent().build();
    }

    @GetMapping("/books")
    @Operation(summary = "Buscar libros")
    public PageResponse<AdminCatalogResponses.Book> searchBooks(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) @Pattern(regexp = STATE_PATTERN) String state,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        var result = service.searchBooks(actorId(jwt), new Search(query, state, page, pageSize));
        return page(result, page, pageSize, row -> new AdminCatalogResponses.Book(row.bookId(), row.title(),
                row.subtitle(), row.synopsis(), row.state(), row.authors().stream()
                        .map(author -> new AdminCatalogResponses.BookAuthor(author.authorId(), author.name(), author.order())).toList(),
                row.categories().stream().map(category -> new AdminCatalogResponses.BookCategory(category.categoryId(),
                        category.name(), category.slug())).toList(), row.createdAt(), row.updatedAt()));
    }

    @PostMapping(path = "/books", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Crear libro")
    public ResponseEntity<AdminCatalogResponses.BookCreated> createBook(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody AdminCatalogRequests.Book request) {
        long id = service.createBook(actorId(jwt), bookData(request));
        return ResponseEntity.status(HttpStatus.CREATED).body(new AdminCatalogResponses.BookCreated(Long.toString(id)));
    }

    @PutMapping(path = "/books/{bookId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> updateBook(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long bookId,
            @Valid @RequestBody AdminCatalogRequests.Book request) {
        service.updateBook(actorId(jwt), bookId, bookData(request)); return ResponseEntity.noContent().build();
    }

    @PutMapping(path = "/books/{bookId}/status", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> bookStatus(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long bookId,
            @Valid @RequestBody AdminCatalogRequests.Status request) {
        service.setBookStatus(actorId(jwt), bookId, request.state()); return ResponseEntity.noContent().build();
    }

    @GetMapping("/editions")
    @Operation(summary = "Buscar ediciones")
    public PageResponse<AdminCatalogResponses.Edition> searchEditions(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) @Pattern(regexp = STATE_PATTERN) String state,
            @RequestParam(required = false) @Positive Long bookId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        var result = service.searchEditions(actorId(jwt), new EditionSearch(query, state, bookId, page, pageSize));
        return page(result, page, pageSize, row -> new AdminCatalogResponses.Edition(row.editionId(), row.bookId(),
                row.bookTitle(), row.publisherId(), row.publisherName(), row.sku(), row.isbn13(), row.language(),
                row.format(), row.pageCount(), row.publicationDate() == null ? null : row.publicationDate().toString(),
                row.price().setScale(2, RoundingMode.UNNECESSARY).toPlainString(), row.coverUrl(), row.coverLicense(),
                row.coverSourceUrl(), row.coverAttribution(), row.state(), row.stockActual(), row.createdAt(), row.updatedAt()));
    }

    @PostMapping(path = "/editions", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Crear edición")
    public ResponseEntity<AdminCatalogResponses.EditionCreated> createEdition(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody EditionCreate request) {
        long id = service.createEdition(actorId(jwt), new EditionCreateData(Long.parseLong(request.bookId()),
                Long.parseLong(request.publisherId()), request.sku(), request.isbn13(), request.language(),
                request.format(), request.pageCount(), request.publicationDate(), new java.math.BigDecimal(request.price()),
                request.coverUrl(), request.coverLicense(), request.coverSourceUrl(), request.coverAttribution()));
        return ResponseEntity.status(HttpStatus.CREATED).body(new AdminCatalogResponses.EditionCreated(Long.toString(id)));
    }

    @PutMapping(path = "/editions/{editionId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> updateEdition(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long editionId,
            @Valid @RequestBody EditionUpdate request) {
        service.updateEdition(actorId(jwt), editionId, new EditionUpdateData(Long.parseLong(request.publisherId()),
                request.isbn13(), request.language(), request.format(), request.pageCount(), request.publicationDate(),
                new java.math.BigDecimal(request.price()), request.coverUrl(), request.coverLicense(),
                request.coverSourceUrl(), request.coverAttribution()));
        return ResponseEntity.noContent().build();
    }

    @PutMapping(path = "/editions/{editionId}/status", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> editionStatus(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long editionId,
            @Valid @RequestBody AdminCatalogRequests.Status request) {
        service.setEditionStatus(actorId(jwt), editionId, request.state()); return ResponseEntity.noContent().build();
    }

    private static CategoryData categoryData(AdminCatalogRequests.Category request) {
        return new CategoryData(request.name(), request.slug(), request.description(),
                request.parentCategoryId() == null ? null : Long.parseLong(request.parentCategoryId()));
    }

    private static BookData bookData(AdminCatalogRequests.Book request) {
        return new BookData(request.title(), request.subtitle(), request.synopsis(), request.authors().stream()
                .map(AdminCatalogController::bookAuthor).toList(), request.categoryIds().stream()
                        .map(Long::parseLong).toList());
    }

    private static BookAuthorInput bookAuthor(AuthorAssignment author) {
        return new BookAuthorInput(Long.parseLong(author.authorId()), author.order());
    }

    private static long actorId(Jwt jwt) { return Long.parseLong(jwt.getSubject()); }

    private static <T, R> PageResponse<R> page(Page<T> page, int pageNumber, int pageSize,
            java.util.function.Function<T, R> mapper) {
        return new PageResponse<>(page.items().stream().map(mapper).toList(), pageNumber, pageSize,
                Long.toString(page.totalCount()));
    }
}
