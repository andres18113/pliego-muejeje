package com.pliego.modules.customer.application;

import java.util.List;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.foundation.security.CurrentPasswordMismatchException;
import com.pliego.modules.customer.gateway.CustomerGateway;
import java.util.UUID;
import com.pliego.modules.customer.gateway.CustomerGateway.AddressData;
import com.pliego.modules.customer.application.CustomerFavorites.Page;
import com.pliego.modules.customer.application.CustomerFavorites.Status;

@Service
public class CustomerService {

    private final CustomerGateway customerGateway;
    private final PasswordEncoder passwordEncoder;
    private final ApplicationEventPublisher events;
    private final com.pliego.modules.identity.application.EmailActionService emailActions;

    public CustomerService(CustomerGateway customerGateway, PasswordEncoder passwordEncoder,
            ApplicationEventPublisher events, com.pliego.modules.identity.application.EmailActionService emailActions) {
        this.customerGateway = customerGateway;
        this.passwordEncoder = passwordEncoder;
        this.events = events;
        this.emailActions = emailActions;
    }

    @Transactional(readOnly = true)
    public CustomerProfile getProfile(long actorUserId) {
        CustomerGateway.CustomerProfile profile = customerGateway.findProfile(actorUserId);
        return new CustomerProfile(profile.customerId(), profile.email(), profile.firstNames(), profile.lastNames(),
                profile.phone(), profile.state(), profile.version());
    }

    @Transactional
    public void updateProfile(long actorUserId, long expectedVersion, String firstNames, String lastNames, String phone) {
        customerGateway.updateProfile(actorUserId, expectedVersion, firstNames, lastNames, phone);
    }

    @Transactional
    public void patchProfile(long actorUserId, long expectedVersion, String field, String value) {
        customerGateway.patchProfile(actorUserId, expectedVersion, field, value);
    }

    @Transactional
    public AddressAttempt resolveAddress(long actorUserId, UUID key) {
        return customerGateway.resolveAddress(actorUserId, key);
    }

    /**
     * Replaces the sign-in email after re-authenticating with the current password. The database
     * routine owns normalization, validation and uniqueness; changed email requires verification and
     * revokes refresh sessions. The verification intent joins this Spring transaction.
     */
    @Transactional
    public String changeEmail(long actorUserId, String newEmail, String currentPassword) {
        String passwordHash = customerGateway.passwordHash(actorUserId);
        if (passwordHash == null || !passwordEncoder.matches(currentPassword, passwordHash)) {
            throw new CurrentPasswordMismatchException();
        }
        String previousEmail = customerGateway.findProfile(actorUserId).email();
        String email = customerGateway.changeEmail(actorUserId, newEmail);
        if (!email.equals(previousEmail)) {
            emailActions.verifyChangedEmail(actorUserId);
            events.publishEvent(new CustomerEmailChanged(actorUserId, previousEmail, email));
        }
        return email;
    }

    @Transactional(readOnly = true)
    public List<CustomerAddress> listAddresses(long actorUserId) {
        return customerGateway.listAddresses(actorUserId).stream()
                .map(address -> new CustomerAddress(address.addressId(), address.alias(), address.recipient(),
                        address.line1(), address.line2(), address.city(), address.province(), address.countryCode(),
                        address.postalCode(), address.reference(), address.phone(), address.primary()))
                .toList();
    }

    @Transactional
    public long createAddress(long actorUserId, UUID key, AddressInput address, boolean makePrimary) {
        return customerGateway.createAddress(actorUserId, key, toGatewayAddress(address), makePrimary);
    }

    @Transactional
    public void updateAddress(long actorUserId, long addressId, AddressInput address) {
        customerGateway.updateAddress(actorUserId, addressId, toGatewayAddress(address));
    }

    @Transactional
    public void deleteAddress(long actorUserId, long addressId) {
        customerGateway.deleteAddress(actorUserId, addressId);
    }

    @Transactional
    public void setPrimaryAddress(long actorUserId, long addressId) {
        customerGateway.setPrimaryAddress(actorUserId, addressId);
    }

    @Transactional(readOnly = true)
    public Page listFavorites(long actorUserId, int page, int pageSize) {
        return customerGateway.listFavorites(actorUserId, page, pageSize);
    }

    @Transactional(readOnly = true)
    public List<Status> favoriteStatus(long actorUserId, List<Long> editionIds) {
        return customerGateway.favoriteStatus(actorUserId, editionIds);
    }

    @Transactional
    public void addFavorite(long actorUserId, long editionId) {
        customerGateway.addFavorite(actorUserId, editionId);
    }

    @Transactional
    public void removeFavorite(long actorUserId, long editionId) {
        customerGateway.removeFavorite(actorUserId, editionId);
    }

    private static AddressData toGatewayAddress(AddressInput address) {
        return new AddressData(address.alias(), address.recipient(), address.line1(), address.line2(), address.city(),
                address.province(), address.countryCode(), address.postalCode(), address.reference(), address.phone());
    }
}
