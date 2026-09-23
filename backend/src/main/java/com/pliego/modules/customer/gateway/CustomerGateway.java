package com.pliego.modules.customer.gateway;

import java.util.List;

public interface CustomerGateway {

    CustomerProfile findProfile(long actorUserId);

    void updateProfile(long actorUserId, String firstNames, String lastNames, String phone);

    List<CustomerAddress> listAddresses(long actorUserId);

    long createAddress(long actorUserId, AddressData address, boolean makePrimary);

    void updateAddress(long actorUserId, long addressId, AddressData address);

    void deleteAddress(long actorUserId, long addressId);

    void setPrimaryAddress(long actorUserId, long addressId);

    record CustomerProfile(long customerId, String email, String firstNames, String lastNames, String phone,
            String state) {
    }

    record CustomerAddress(long addressId, String alias, String recipient, String line1, String line2,
            String city, String province, String countryCode, String postalCode, String reference, String phone,
            boolean primary) {
    }

    record AddressData(String alias, String recipient, String line1, String line2, String city, String province,
            String countryCode, String postalCode, String reference, String phone) {
    }
}
