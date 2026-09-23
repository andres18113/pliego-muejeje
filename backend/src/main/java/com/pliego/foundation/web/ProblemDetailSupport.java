package com.pliego.foundation.web;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;

import jakarta.servlet.http.HttpServletRequest;

final class ProblemDetailSupport {

    private ProblemDetailSupport() {
    }

    static ResponseEntity<ProblemDetail> response(ProblemDetailFactory factory, HttpServletRequest request,
            String code, String detail) {
        ProblemDetail problem = factory.create(code, code, HttpStatus.BAD_REQUEST, detail, request);
        return ResponseEntity.badRequest().body(problem);
    }

    static ResponseEntity<ProblemDetail> response(ProblemDetailFactory factory, HttpServletRequest request,
            String code, String title, HttpStatus status, String detail) {
        return ResponseEntity.status(status).body(factory.create(code, title, status, detail, request));
    }

    static void violations(ProblemDetail problem, List<Violation> violations) {
        problem.setProperty("violations", violations.stream()
                .map(violation -> new ViolationItem(violation.field(), violation.message()))
                .toList());
    }

    record Violation(String field, String message) {
    }

    record ViolationItem(String field, String message) {
    }
}
