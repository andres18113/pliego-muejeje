package com.pliego.foundation.database;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.JdbcTransactionManager;

/** One independent connection keeps short admission commits available when login fills the main pool. */
@Configuration(proxyBeanMethods = false)
public class LoginAdmissionDatabaseConfiguration {
    @Bean(defaultCandidate = false, destroyMethod = "close")
    public HikariDataSource loginAdmissionDataSource(@Qualifier("dataSource") HikariDataSource main) {
        // Copy credentials, JDBC/SSL properties and timeouts without duplicating secret configuration.
        // Lazy startup also keeps fake-gateway context tests independent of PostgreSQL.
        var admission = new HikariDataSource();
        main.copyStateTo(admission);
        admission.setPoolName("pliego-login-admission");
        admission.setMaximumPoolSize(1);
        admission.setMinimumIdle(0);
        return admission;
    }

    @Bean(defaultCandidate = false)
    public JdbcTemplate loginAdmissionJdbcTemplate(@Qualifier("loginAdmissionDataSource") HikariDataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Bean(defaultCandidate = false)
    public JdbcTransactionManager loginAdmissionTransactionManager(
            @Qualifier("loginAdmissionDataSource") HikariDataSource dataSource) {
        return new JdbcTransactionManager(dataSource);
    }
}
