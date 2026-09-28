package com.pliego.modules.sales.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Read-only bank details supplied by deployment configuration. */
@RestController
@RequestMapping(path = "/api/v1/reference", produces = MediaType.APPLICATION_JSON_VALUE)
public class TransferReferenceController {
    private final TransferDetails transferDetails;

    public TransferReferenceController(
            @Value("${pliego.checkout.transfer.bank}") String bank,
            @Value("${pliego.checkout.transfer.beneficiary}") String beneficiary,
            @Value("${pliego.checkout.transfer.account-type}") String accountType,
            @Value("${pliego.checkout.transfer.account-number}") String accountNumber,
            @Value("${pliego.checkout.transfer.identification}") String identification) {
        transferDetails = new TransferDetails(bank, beneficiary, accountType, accountNumber, identification);
    }

    @GetMapping("/transfer-details")
    public TransferDetails transferDetails() {
        return transferDetails;
    }

    public record TransferDetails(String bank, String beneficiary, String accountType, String accountNumber,
            String identification) { }
}
