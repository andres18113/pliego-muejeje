package com.pliego.modules.identity.api;

import com.pliego.foundation.security.ValidPassword;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import io.swagger.v3.oas.annotations.media.Schema;

public final class EmailActionRequests {
 private EmailActionRequests() {}
 @Schema(name="EmailActionRequest")
 public record EmailRequest(@NotBlank(message="El correo es obligatorio.") @Email(message="Escribe un correo válido.")
   @Size(max=254,message="El correo admite hasta 254 caracteres.") String email) {
  @Override public String toString() {return "EmailRequest[redacted]";}
 }
 @Schema(name="EmailVerificationRequest")
 public record TokenRequest(@NotNull(message="El token es obligatorio.")
   @Pattern(regexp="[A-Za-z0-9_-]{43}",message="El enlace de verificación no es válido.") String token) {
  @Override public String toString() {return "TokenRequest[redacted]";}
 }
 @Schema(name="PasswordResetRequest")
 public record ResetRequest(@NotNull(message="El token es obligatorio.")
   @Pattern(regexp="[A-Za-z0-9_-]{43}",message="El enlace de recuperación no es válido.") String token,
   @NotNull(message="La contraseña es obligatoria.") @ValidPassword @Schema(format="password") String password) {
  @Override public String toString() {return "ResetRequest[redacted]";}
 }
 public record AcceptedResponse(String message) {}
}
