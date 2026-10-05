package com.pliego.foundation.validation;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class PersonRulesTest {
    @Test void sharedUnicodeVectorsMatchTheFrontendContract() throws Exception {
        try(var input=getClass().getResourceAsStream("/validation/person-cases.json")) {
            var cases=JsonMapper.builder().build().readTree(input);
            for(var entry:cases.path("names")) {
                String raw=entry.path("input").asText();
                assertEquals(entry.path("valid").asBoolean(),PersonRules.nameError(raw,"nombres")==null,raw);
                if(entry.path("valid").asBoolean()) assertEquals(entry.path("normalized").asText(),PersonRules.name(raw));
            }
        }
    }
    @Test void sharedPhoneVectorsUseMatchingMetadataAndPreserveDigits() throws Exception {
        try(var input=getClass().getResourceAsStream("/validation/person-cases.json")) {
            var cases=JsonMapper.builder().build().readTree(input);
            for(var entry:cases.path("phones")) {
                String raw=entry.path("input").asText();
                assertEquals(entry.path("valid").asBoolean(),PhoneNumbers.error(raw,false)==null,raw);
                if(entry.path("valid").asBoolean()) assertEquals(entry.path("normalized").asText(),PhoneNumbers.normalized(raw));
            }
        }
    }
    @Test void namesAndRecipientsCountCodePointsAndDoNotLoseLettersAtTheirEdges() {
        assertNull(PersonRules.nameError("𐐀".repeat(120),"nombres"));
        assertNotNull(PersonRules.nameError("𐐀".repeat(121),"nombres"));
        assertEquals("Lev",PersonRules.name(" Lev "));
        assertNull(PersonRules.recipientError("𐐀".repeat(120)+" "+"李".repeat(120)));
    }
}
