package com.pliego.modules.customer.api;

import java.util.List;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Countries currently supported for new delivery addresses. Historical country values remain readable. */
@RestController
@RequestMapping(path = "/api/v1/reference", produces = MediaType.APPLICATION_JSON_VALUE)
public class CountryReferenceController {

    @GetMapping("/countries")
    public List<Country> countries() {
        return List.of(new Country("EC", "Ecuador"));
    }

    public record Country(String code, String name) { }
}
