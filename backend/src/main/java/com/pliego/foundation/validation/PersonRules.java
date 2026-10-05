package com.pliego.foundation.validation;

import java.io.InputStream;
import java.text.Normalizer;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** One immutable contract, also consumed by frontend and the V037 Database API. */
public final class PersonRules {
    private static final JsonNode RULES = load();
    private static final Pattern NAME = Pattern.compile(RULES.path("namePattern").asText());
    private static final Pattern SPACES = Pattern.compile(RULES.path("spaceSeparatorPattern").asText());
    private static final Pattern OUTER = Pattern.compile(RULES.path("outerWhitespacePattern").asText());
    private PersonRules() { }
    private static JsonNode load() {
        try (InputStream input = PersonRules.class.getResourceAsStream("/validation/person-rules.json")) {
            if (input == null) throw new IllegalStateException("Missing person validation contract");
            return JsonMapper.builder().build().readTree(input);
        } catch (Exception failure) { throw new ExceptionInInitializerError(failure); }
    }
    public static String message(String key) { return RULES.path("messages").path(key).asText(); }
    public static String rule(String key) { return RULES.path(key).asText(); }
    public static String presentation(String input) {
        return input == null ? null : OUTER.matcher(SPACES.matcher(input).replaceAll(" ")).replaceAll("");
    }
    public static String name(String input) {
        return input == null ? null : presentation(Normalizer.normalize(input, Normalizer.Form.NFC));
    }
    public static String nameError(String input, String label) {
        String value = name(input);
        String key = value == null || value.isEmpty() ? "nameEmpty"
                : value.codePointCount(0,value.length()) > RULES.path("maxNameCodePoints").asInt() ? "nameTooLong"
                : !NAME.matcher(value).matches() ? "nameCharacters" : null;
        return key == null ? null : message(key).replace("{label}",label);
    }
    public static String recipientError(String input) {
        String value=name(input);
        if(value==null || value.isEmpty()) return message("recipientEmpty");
        return value.codePointCount(0,value.length())>RULES.path("maxRecipientCodePoints").asInt() ? message("recipientTooLong") : null;
    }
}
