package com.pliego.foundation.web;

import java.net.URI;

import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;

@Component
public final class ProblemDetailFactory {

    public ProblemDetail create(String code, String title, HttpStatusCode status, String detail,
            HttpServletRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setType(URI.create("urn:pliego:problem:" + code));
        problem.setTitle(title);
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("code", code);
        Object traceId = request.getAttribute(TraceIdFilter.ATTRIBUTE);
        problem.setProperty("traceId", traceId instanceof String value ? value : "unavailable");
        return problem;
    }
}
