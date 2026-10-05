package com.pliego.modules.customer.gateway;

import java.util.List;
import java.util.UUID;
import com.pliego.modules.customer.application.AddressAttempt;

import com.pliego.modules.customer.application.CustomerFavorites.Page;
import com.pliego.modules.customer.application.CustomerFavorites.Status;

public interface CustomerGateway {

    CustomerProfile findProfile(long actorUserId);

    void updateProfile(long actorUserId, long expectedVersion, String firstNames, String lastNames, String phone);
    void patchProfile(long actorUserId, long expectedVersion, String field, String value);
    /** Current BCrypt hash of the CUSTOMER actor, for re-authentication before an identity change. */
    String passwordHash(long actorUserId);
    /** Replaces the sign-in email; returns the normalized email now stored. */
    String changeEmail(long actorUserId, String newEmail);

    List<CustomerAddress> listAddresses(long actorUserId);

    long createAddress(long actorUserId, UUID key, AddressData address, boolean makePrimary);
    AddressAttempt resolveAddress(long actorUserId, UUID key);

    void updateAddress(long actorUserId, long addressId, AddressData address);

    void deleteAddress(long actorUserId, long addressId);

    void setPrimaryAddress(long actorUserId, long addressId);

    Page listFavorites(long actorUserId, int page, int pageSize);

    List<Status> favoriteStatus(long actorUserId, List<Long> editionIds);

    void addFavorite(long actorUserId, long editionId);

    void removeFavorite(long actorUserId, long editionId);

    record CustomerProfile(long customerId, String email, String firstNames, String lastNames, String phone,
            String state, long version) {
        public CustomerProfile(long customerId, String email, String firstNames, String lastNames, String phone, String state) {
            this(customerId, email, firstNames, lastNames, phone, state, 0);
        }
    }

    record CustomerAddress(long addressId, String alias, String recipient, String line1, String line2,
            String city, String province, String countryCode, String postalCode, String reference, String phone,
            boolean primary) {
    }

    record AddressData(String alias, String recipient, String line1, String line2, String city, String province,
            String countryCode, String postalCode, String reference, String phone) {
    }
}
