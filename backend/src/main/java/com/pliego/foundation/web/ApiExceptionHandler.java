package com.pliego.foundation.web;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import com.pliego.foundation.database.DatabaseException;
import com.pliego.foundation.security.InvalidCredentialsException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;

@RestControllerAdvice
public final class ApiExceptionHandler {

    private static final String VALIDATION_TITLE = "Datos inválidos";
    private static final String VALIDATION_DETAIL = "Revisa los datos enviados e intenta nuevamente.";
    private static final String MALFORMED_TITLE = "Solicitud inválida";
    private static final String MALFORMED_DETAIL = "El cuerpo de la solicitud falta o no contiene JSON válido.";
    private static final String INTERNAL_TITLE = "Error interno";
    private static final String INTERNAL_DETAIL = "Ocurrió un error interno. Intenta nuevamente.";

    private final ProblemDetailFactory problems;

    public ApiExceptionHandler(ProblemDetailFactory problems) {
        this.problems = problems;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> validation(MethodArgumentNotValidException exception,
            HttpServletRequest request) {
        List<ProblemDetailSupport.Violation> violations = exception.getBindingResult().getFieldErrors().stream()
                .map(ApiExceptionHandler::safeViolation)
                .toList();
        ProblemDetail problem = problems.create("VALIDATION_ERROR", VALIDATION_TITLE, HttpStatus.BAD_REQUEST,
                VALIDATION_DETAIL, request);
        ProblemDetailSupport.violations(problem, violations);
        return ResponseEntity.badRequest().body(problem);
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ProblemDetail> methodValidation(HandlerMethodValidationException exception,
            HttpServletRequest request) {
        return ProblemDetailSupport.response(problems, request, "VALIDATION_ERROR", VALIDATION_TITLE,
                HttpStatus.BAD_REQUEST, VALIDATION_DETAIL);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ProblemDetail> constraintValidation(ConstraintViolationException exception,
            HttpServletRequest request) {
        return ProblemDetailSupport.response(problems, request, "VALIDATION_ERROR", VALIDATION_TITLE,
                HttpStatus.BAD_REQUEST, VALIDATION_DETAIL);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ProblemDetail> argumentTypeMismatch(MethodArgumentTypeMismatchException exception,
            HttpServletRequest request) {
        return ProblemDetailSupport.response(problems, request, "VALIDATION_ERROR", VALIDATION_TITLE,
                HttpStatus.BAD_REQUEST, VALIDATION_DETAIL);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ProblemDetail> malformedRequest(HttpMessageNotReadableException exception,
            HttpServletRequest request) {
        return ProblemDetailSupport.response(problems, request, "MALFORMED_JSON", MALFORMED_TITLE,
                HttpStatus.BAD_REQUEST, MALFORMED_DETAIL);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ProblemDetail> resourceNotFound(HttpServletRequest request) {
        return ProblemDetailSupport.response(problems, request, "NOT_FOUND", "Recurso no encontrado",
                HttpStatus.NOT_FOUND, "El recurso solicitado no está disponible.");
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<ProblemDetail> invalidCredentials(InvalidCredentialsException exception,
            HttpServletRequest request) {
        return ProblemDetailSupport.response(problems, request, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas",
                HttpStatus.UNAUTHORIZED, "El correo o la contraseña son incorrectos.");
    }

    @ExceptionHandler(DatabaseException.class)
    public ResponseEntity<ProblemDetail> database(DatabaseException exception, HttpServletRequest request) {
        var error = exception.error();
        String detail = databaseDetail(error);
        String publicCode = switch (error) {
            case DATABASE_CONTRACT_VIOLATION, INTERNAL_SERVER_ERROR -> error.code();
            default -> error.sqlState();
        };
        ProblemDetail problem = problems.create(publicCode, databaseTitle(error), error.httpStatus(), detail, request);
        return ResponseEntity.status(error.httpStatus()).body(problem);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> unexpected(Exception exception, HttpServletRequest request) {
        return ProblemDetailSupport.response(problems, request, "INTERNAL_SERVER_ERROR", INTERNAL_TITLE,
                HttpStatus.INTERNAL_SERVER_ERROR, INTERNAL_DETAIL);
    }

    private static ProblemDetailSupport.Violation safeViolation(FieldError error) {
        String message = error.getDefaultMessage();
        if (message == null || message.isBlank()) message = "El valor no es válido.";
        return new ProblemDetailSupport.Violation(error.getField(), message);
    }

    private static String databaseTitle(com.pliego.foundation.database.DatabaseError error) {
        return switch (error) {
            case INVALID_ARGUMENT -> VALIDATION_TITLE;
            case ACTOR_NOT_FOUND -> "Sesión inválida";
            case ACTOR_INACTIVE -> "Cuenta bloqueada";
            case ACTOR_NOT_ADMIN, ACTOR_NOT_CUSTOMER -> "Acceso denegado";
            case EMAIL_ALREADY_EXISTS -> "Correo ya registrado";
            case CUSTOMER_NOT_FOUND -> "Perfil no encontrado";
            case ADDRESS_NOT_FOUND -> "Dirección no encontrada";
            case AUTHOR_NOT_FOUND -> "Autor no encontrado";
            case AUTHOR_INACTIVE -> "Autor no disponible";
            case PUBLISHER_NOT_FOUND -> "Editorial no encontrada";
            case PUBLISHER_INACTIVE -> "Editorial no disponible";
            case CATEGORY_NOT_FOUND -> "Categoría no encontrada";
            case CATEGORY_INACTIVE -> "Categoría no disponible";
            case CATEGORY_INVALID_HIERARCHY -> "Jerarquía de categorías inválida";
            case CATEGORY_SLUG_EXISTS -> "Identificador de categoría ya registrado";
            case BOOK_NOT_FOUND -> "Libro no encontrado";
            case BOOK_REQUIRES_AUTHOR -> "Falta asociar un autor";
            case BOOK_REQUIRES_CATEGORY -> "Falta asociar una categoría";
            case AUTHOR_ORDER_INVALID -> "Orden de autores inválido";
            case EDITION_NOT_FOUND -> "Edición no encontrada";
            case EDITION_INACTIVE -> "Edición no disponible";
            case BOOK_INACTIVE -> "Libro no disponible";
            case SKU_ALREADY_EXISTS -> "SKU ya registrado";
            case ISBN_ALREADY_EXISTS -> "ISBN ya registrado";
            case ISBN_INVALID -> "ISBN inválido";
            case COVER_METADATA_INVALID -> "Datos de portada inválidos";
            case EDITION_DATA_INVALID -> "Datos de edición inválidos";
            case INVENTORY_NOT_FOUND -> "Inventario no encontrado";
            case INSUFFICIENT_STOCK -> "Existencias insuficientes";
            case STOCK_QUANTITY_INVALID -> "Cantidad de existencias inválida";
            case STOCK_MINIMUM_INVALID -> "Mínimo de existencias inválido";
            case STOCK_MOVEMENT_DUPLICATE -> "Movimiento de existencias duplicado";
            case SALE_REQUIRED_FOR_CANCELLATION -> "Se requiere una venta para cancelar";
            case CART_NOT_ACTIVE -> "Carrito no activo";
            case CART_EMPTY -> "Carrito vacío";
            case CART_ITEM_NOT_FOUND -> "Artículo del carrito no encontrado";
            case CART_QUANTITY_INVALID -> "Cantidad del carrito inválida";
            case ORDER_NOT_FOUND -> "Pedido no encontrado";
            case ORDER_INVALID_TRANSITION -> "Cambio de estado del pedido inválido";
            case ORDER_NOT_CANCELLABLE -> "Pedido no cancelable";
            case CHECKOUT_ADDRESS_INVALID -> "Dirección no disponible";
            case PAYMENT_OUTCOME_INVALID -> "Resultado de pago inválido";
            case PAYMENT_STATE_INVALID -> "Estado de pago inválido";
            case PAYMENT_REFERENCE_CONFLICT -> "Referencia de pago en conflicto";
            case IMMUTABLE_HISTORY_VIOLATION -> "No se pudo completar la operación";
            case DATABASE_CONTRACT_VIOLATION, INTERNAL_SERVER_ERROR -> INTERNAL_TITLE;
        };
    }

    private static String databaseDetail(com.pliego.foundation.database.DatabaseError error) {
        return switch (error) {
            case ACTOR_NOT_FOUND -> "La sesión no es válida. Inicia sesión nuevamente.";
            case ACTOR_INACTIVE -> "Tu cuenta está bloqueada y no puede realizar esta operación.";
            case ACTOR_NOT_ADMIN, ACTOR_NOT_CUSTOMER -> "No tienes permiso para realizar esta operación.";
            case EMAIL_ALREADY_EXISTS -> "Ya existe una cuenta con ese correo electrónico.";
            case CUSTOMER_NOT_FOUND -> "El perfil solicitado no está disponible.";
            case ADDRESS_NOT_FOUND -> "La dirección solicitada no existe o no está disponible para tu cuenta.";
            default -> switch (error.httpStatus().value()) {
                case 400 -> VALIDATION_DETAIL;
                case 404 -> "El recurso solicitado no está disponible.";
                case 409 -> "La operación entra en conflicto con el estado actual.";
                default -> INTERNAL_DETAIL;
            };
        };
    }
}
