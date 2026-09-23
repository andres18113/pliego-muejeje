package com.pliego.modules.identity.gateway;

public final class UserAuthData {

    private final long userId;
    private final String email;
    private final String passwordHash;
    private final String role;
    private final String state;

    public UserAuthData(long userId, String email, String passwordHash, String role, String state) {
        this.userId = userId;
        this.email = email;
        this.passwordHash = passwordHash;
        this.role = role;
        this.state = state;
    }

    public long userId() {
        return userId;
    }

    public String email() {
        return email;
    }

    public String passwordHash() {
        return passwordHash;
    }

    public String role() {
        return role;
    }

    public String state() {
        return state;
    }

    @Override
    public String toString() {
        return "UserAuthData[userId=" + userId + ", email=" + email + ", passwordHash=[redacted], role=" + role
                + ", state=" + state + "]";
    }
}
