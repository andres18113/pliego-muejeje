package com.pliego.foundation.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Stream;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.slf4j.LoggerFactory;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;
import org.springframework.web.servlet.mvc.method.annotation.ExceptionHandlerExceptionResolver;

import com.pliego.foundation.security.InvalidCredentialsException;

import static org.assertj.core.api.Assertions.assertThat;

class ApiExceptionHandlerSseTest {

    private static final String EVENTS = "/api/v1/auth/events";
    private static final String HEARTBEAT = ":heartbeat\n\n";
    private final Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
    private final Logger handler = (Logger) LoggerFactory.getLogger(ApiExceptionHandler.class);
    private final ListAppender<ILoggingEvent> log = new ListAppender<>();
    private final StaticApplicationContext context = new StaticApplicationContext();
    private Level previousLevel;

    @BeforeEach
    void captureResolverAndHandlerLogs() {
        previousLevel = handler.getLevel();
        handler.setLevel(Level.DEBUG);
        log.start();
        root.addAppender(log);
        context.getBeanFactory().registerSingleton("apiExceptionHandler",
                new ApiExceptionHandler(new ProblemDetailFactory()));
        context.refresh();
    }

    @AfterEach
    void restoreLoggingAndCloseContext() {
        root.detachAppender(log);
        log.stop();
        handler.setLevel(previousLevel);
        context.close();
    }

    static Stream<Exception> expectedStreamEndings() {
        return Stream.of(new IOException("Broken pipe"),
                new IOException("Connection reset by peer"),
                new AsyncRequestNotUsableException("ServletOutputStream failed to write",
                        new IOException("Broken pipe")),
                new AsyncRequestNotUsableException("Response not usable after async request completion."),
                new AsyncRequestNotUsableException("Response not usable after response errors."),
                new AsyncRequestTimeoutException());
    }

    @ParameterizedTest
    @MethodSource("expectedStreamEndings")
    void committedSseClosureIsHandledWithoutProblemBodyOrWarning(Exception exception) throws Exception {
        var request = eventsRequest("");
        var response = committedSse();

        var resolved = resolver(false).resolveException(request, response, null, exception);

        assertThat(resolved).isNotNull();
        assertThat(resolved.isEmpty()).isTrue();
        assertUnchangedStream(response);
        assertThat(log.list).noneMatch(event -> event.getLevel().isGreaterOrEqual(Level.WARN));
    }

    @Test
    void closedSseNeverAppendsProblemEvenIfAConverterCouldWriteIt() throws Exception {
        var response = committedSse();

        resolver(true).resolveException(eventsRequest(""), response, null, new IOException("Broken pipe"));

        assertUnchangedStream(response);
        assertThat(log.list).noneMatch(event -> event.getLevel().isGreaterOrEqual(Level.WARN));
    }

    @Test
    void contextPathDoesNotPreventHandlingTheExactEventsEndpoint() throws Exception {
        var response = committedSse();

        var resolved = resolver(false).resolveException(eventsRequest("/pliego"), response, null,
                new AsyncRequestTimeoutException());

        assertThat(resolved).isNotNull();
        assertUnchangedStream(response);
        assertThat(log.list).noneMatch(event -> event.getLevel().isGreaterOrEqual(Level.WARN));
    }

    static Stream<Exception> realServerFailures() {
        return Stream.of(new IllegalStateException("Publisher invariant failed"),
                new AsyncRequestNotUsableException("ServletOutputStream failed to write",
                        new IOException("Unexpected server I/O failure")),
                new RuntimeException(new AsyncRequestNotUsableException("ServletOutputStream failed to write",
                        new IOException("Unexpected server I/O failure"))),
                new DataAccessResourceFailureException("Database connection failed", new IOException("Broken pipe")));
    }

    @ParameterizedTest
    @MethodSource("realServerFailures")
    void committedSseServerFailureStaysVisibleWithoutCorruptingTheStream(Exception exception) throws Exception {
        var response = committedSse();

        var resolved = resolver(false).resolveException(eventsRequest(""), response, null, exception);

        assertThat(resolved).isNotNull();
        assertUnchangedStream(response);
        assertThat(log.list).anySatisfy(event -> {
            assertThat(event.getLoggerName()).isEqualTo(ApiExceptionHandler.class.getName());
            assertThat(event.getLevel()).isEqualTo(Level.ERROR);
            assertThat(event.getThrowableProxy()).isNotNull();
        });
        assertThat(log.list).noneMatch(event -> event.getFormattedMessage().contains("Failure in @ExceptionHandler"));
    }

    @Test
    void failureBeforeStreamStartStillProducesSpanishInternalProblem() throws Exception {
        var request = eventsRequest("");
        request.addHeader("Accept", MediaType.ALL_VALUE);
        var response = new MockHttpServletResponse();

        resolver(false).resolveException(request, response, null, new IllegalStateException("Server failed"));

        assertThat(response.getStatus()).isEqualTo(500);
        assertThat(response.getContentType()).startsWith(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        assertThat(response.getContentAsString()).contains("INTERNAL_SERVER_ERROR", "Error interno",
                "Ocurrió un error interno. Intenta nuevamente.");
    }

    @Test
    void authenticationFailureBeforeStreamStartKeepsSpanish401() throws Exception {
        var response = new MockHttpServletResponse();

        resolver(false).resolveException(eventsRequest(""), response, null, new InvalidCredentialsException());

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("AUTH_INVALID_CREDENTIALS", "Credenciales inválidas",
                "El correo o la contraseña son incorrectos.");
    }

    @Test
    void restBrokenPipeStillUsesTheExistingSpanishInternalProblem() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/v1/catalog/editions");
        request.addHeader("Accept", MediaType.TEXT_EVENT_STREAM_VALUE);
        var response = new MockHttpServletResponse();

        resolver(true).resolveException(request, response, null, new IOException("Broken pipe"));

        assertThat(response.getStatus()).isEqualTo(500);
        assertThat(response.getContentAsString()).contains("INTERNAL_SERVER_ERROR", "Error interno");
    }

    @Test
    void anEventsPrefixOnAnotherEndpointDoesNotSuppressAnException() throws Exception {
        var request = new MockHttpServletRequest("GET", EVENTS + "/other");
        var response = committedSse();

        resolver(true).resolveException(request, response, null, new IOException("Broken pipe"));

        assertThat(response.getContentAsString()).contains("INTERNAL_SERVER_ERROR");
    }

    @Test
    void anAlreadyCommittedJsonResponseAtEventsIsNotTreatedAsSse() throws Exception {
        var response = new MockHttpServletResponse();
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.flushBuffer();

        resolver(false).resolveException(eventsRequest(""), response, null, new IOException("Broken pipe"));

        assertThat(response.getContentAsString()).contains("INTERNAL_SERVER_ERROR");
    }

    private ExceptionHandlerExceptionResolver resolver(boolean acceptsSse) {
        var converter = new JacksonJsonHttpMessageConverter();
        if (acceptsSse) converter.setSupportedMediaTypes(List.of(MediaType.APPLICATION_PROBLEM_JSON, MediaType.ALL));
        var resolver = new ExceptionHandlerExceptionResolver();
        resolver.setApplicationContext(context);
        resolver.setMessageConverters(List.of(converter));
        resolver.afterPropertiesSet();
        return resolver;
    }

    private static MockHttpServletRequest eventsRequest(String contextPath) {
        var request = new MockHttpServletRequest("GET", contextPath + EVENTS);
        request.setContextPath(contextPath);
        return request;
    }

    private static MockHttpServletResponse committedSse() throws IOException {
        var response = new MockHttpServletResponse();
        response.setContentType(MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8");
        response.getOutputStream().write(HEARTBEAT.getBytes(StandardCharsets.UTF_8));
        response.flushBuffer();
        return response;
    }

    private static void assertUnchangedStream(MockHttpServletResponse response) throws Exception {
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentType()).startsWith(MediaType.TEXT_EVENT_STREAM_VALUE);
        assertThat(response.getContentAsString()).isEqualTo(HEARTBEAT);
    }
}
