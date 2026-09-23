package com.pliego.foundation.web;

import java.util.List;

/** Contract pagination wrapper shared by public and authenticated search endpoints. */
public record PageResponse<T>(List<T> items, int page, int pageSize, String totalCount) {

    public PageResponse {
        items = List.copyOf(items);
    }
}
