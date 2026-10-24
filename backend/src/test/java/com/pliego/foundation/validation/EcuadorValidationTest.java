package com.pliego.foundation.validation;

import static org.assertj.core.api.Assertions.assertThat;
import com.pliego.modules.customer.api.CountryReferenceController;
import org.junit.jupiter.api.Test;

class EcuadorValidationTest {
    @Test void foreignCountryIsRejectedWithAnEcuadorSpecificMessage() {
        assertThat(PhoneNumbers.error("+442079460018", false)).contains("Ecuador");
    }
    @Test void excessNationalDigitsHaveTheirOwnExplanation() {
        assertThat(PhoneNumbers.error("+59399123456789", false)).contains("9 dígitos");
    }
    @Test void mobileAndFixedLengthsAreExplainedSeparately() {
        assertThat(PhoneNumbers.error("+59399123", false)).contains("celular", "9 dígitos");
        assertThat(PhoneNumbers.error("+5932555", false)).contains("fijo", "8 dígitos");
    }
    @Test void validContactPhonesAndOptionalClearingRemainSupported() {
        assertThat(PhoneNumbers.error("+593991234567", true)).isNull();
        assertThat(PhoneNumbers.error("+59325550134", true)).isNull();
        assertThat(PhoneNumbers.error("", false)).isNull();
        assertThat(PhoneNumbers.error("", true)).isNotNull();
    }
    @Test void recipientNamesCannotContainDigits() {
        assertThat(PersonRules.recipientError("Ana7 Pérez")).contains("letras");
    }
    @Test void deliveryReferenceExposesOnlySupportedEcuador() {
        assertThat(new CountryReferenceController().countries())
                .containsExactly(new CountryReferenceController.Country("EC", "Ecuador"));
    }
}
