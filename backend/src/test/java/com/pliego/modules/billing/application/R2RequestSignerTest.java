package com.pliego.modules.billing.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

class R2RequestSignerTest {
    private final R2RequestSigner signer = new R2RequestSigner();
    private static final String ACCESS = "AKIAIOSFODNN7EXAMPLE";
    private static final String SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    private static final Instant NOW = Instant.parse("2013-05-24T00:00:00Z");

    @Test
    void signGet_matchesAwsDocumentedHeaderSignatureVector() {
        var signed = signer.sign("GET", URI.create("https://examplebucket.s3.amazonaws.com/test.txt"),
                ACCESS, SECRET, "us-east-1", NOW, new byte[0], Map.of("range", "bytes=0-9"));
        assertThat(signed.headers().get("x-amz-content-sha256"))
                .isEqualTo("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assertThat(signed.headers().get("Authorization")).isEqualTo("AWS4-HMAC-SHA256 Credential=" + ACCESS
                + "/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,"
                + "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    }

    @Test
    void signPut_matchesAwsDocumentedHeaderSignatureVectorAndHashesPayload() {
        byte[] payload = "Welcome to Amazon S3.".getBytes(StandardCharsets.UTF_8);
        var signed = signer.sign("PUT", URI.create("https://examplebucket.s3.amazonaws.com/test$file.text"),
                ACCESS, SECRET, "us-east-1", NOW, payload,
                Map.of("date", "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class", "REDUCED_REDUNDANCY"));
        assertThat(signed.headers().get("x-amz-content-sha256"))
                .isEqualTo("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
        assertThat(signed.headers().get("Authorization")).isEqualTo("AWS4-HMAC-SHA256 Credential=" + ACCESS
                + "/20130524/us-east-1/s3/aws4_request,SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,"
                + "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
    }
}
