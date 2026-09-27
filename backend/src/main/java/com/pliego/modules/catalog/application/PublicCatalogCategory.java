package com.pliego.modules.catalog.application;

/** A category available to public catalog navigation. */
public record PublicCatalogCategory(String slug, String name, String parentSlug) {
}
