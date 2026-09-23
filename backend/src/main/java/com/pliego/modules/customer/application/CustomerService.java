package com.pliego.modules.customer.application;

import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.customer.gateway.CustomerGateway;
import com.pliego.modules.customer.gateway.CustomerGateway.AddressData;

@Service
public class CustomerService {

    private final CustomerGateway customerGateway;

    public CustomerService(CustomerGateway customerGateway) {
        this.customerGateway = customerGateway;
    }

    @Transactional(readOnly = true)
    public CustomerProfile getProfile(long actorUserId) {
        CustomerGateway.CustomerProfile profile = customerGateway.findProfile(actorUserId);
        return new CustomerProfile(profile.customerId(), profile.email(), profile.firstNames(), profile.lastNames(),
                profile.phone(), profile.state());
    }

    @Transactional
    public void updateProfile(long actorUserId, String firstNames, String lastNames, String phone) {
        customerGateway.updateProfile(actorUserId, firstNames, lastNames, phone);
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
    public long createAddress(long actorUserId, AddressInput address, boolean makePrimary) {
        return customerGateway.createAddress(actorUserId, toGatewayAddress(address), makePrimary);
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

    private static AddressData toGatewayAddress(AddressInput address) {
        return new AddressData(address.alias(), address.recipient(), address.line1(), address.line2(), address.city(),
                address.province(), address.countryCode(), address.postalCode(), address.reference(), address.phone());
    }
}
