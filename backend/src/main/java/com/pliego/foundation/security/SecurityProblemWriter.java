package com.pliego.foundation.security;

import java.io.IOException;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;

import com.pliego.foundation.web.ProblemDetailFactory;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import tools.jackson.databind.ObjectMapper;

@Component
public final class SecurityProblemWriter {

    private final ProblemDetailFactory problems;
    private final ObjectMapper objectMapper;

    public SecurityProblemWriter(ProblemDetailFactory problems, ObjectMapper objectMapper) {
        this.problems = problems;
        this.objectMapper = objectMapper;
    }

    public void write(HttpServletRequest request, HttpServletResponse response, String code, String title,
            HttpStatus status, String detail) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        ProblemDetail problem = problems.create(code, title, status, detail, request);
        objectMapper.writeValue(response.getOutputStream(), problem);
    }
}
