import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { EditionSummary } from "@/shared/api/catalog";
import { formatEdition, formatLanguage, formatUsd } from "./formatters";
import { catalogHref, type CatalogCriteria } from "./catalogUrl";
import { BookCover } from "./BookCover";

interface EditionGridProps {
  editions: EditionSummary[];
  criteria: CatalogCriteria;
}

export function EditionGrid({ editions, criteria }: EditionGridProps) {
  return (
    <ul className="edition-grid">
      {editions.map((edition) => (
        <EditionItem key={edition.editionId} edition={edition} criteria={criteria} />
      ))}
    </ul>
  );
}

function EditionItem({
  edition,
  criteria,
}: {
  edition: EditionSummary;
  criteria: CatalogCriteria;
}) {
  const detailHref = `/catalog/editions/${encodeURIComponent(edition.editionId)}?from=${encodeURIComponent(catalogHref(criteria))}`;

  return (
    <li className="edition-item">
      <Link
        className="edition-primary-link"
        to={detailHref}
        state={{
          coverPreview: {
            editionId: edition.editionId,
            url: edition.coverUrl,
            license: edition.coverLicense,
            attribution: edition.coverAttribution,
            title: edition.title,
          },
        }}
        aria-label={`Ver edición: ${edition.title}`}
      >
        <div className="edition-figure">
          <BookCover
            url={edition.coverUrl}
            license={edition.coverLicense}
            attribution={edition.coverAttribution}
            title={edition.title}
            loading="lazy"
          />
        </div>
        <div className="edition-copy">
          <h3 className="edition-title">{edition.title}</h3>
          <p className="edition-author">{edition.authors}</p>
          <p className="edition-publisher">{edition.publisher}</p>
          <p className="edition-format">
            {formatEdition(edition.format)} <span aria-hidden="true">·</span> {formatLanguage(edition.language)}
          </p>
          <p className="edition-price">{formatUsd(edition.price)}</p>
          <p className={`edition-availability ${edition.available ? "is-available" : "is-unavailable"}`}>
            <span className="availability-mark" aria-hidden="true" />
            {edition.available ? "Disponible" : "No disponible"}
          </p>
          <span className="edition-detail-link">
            Ver edición
            <ArrowRight aria-hidden="true" size={16} strokeWidth={1.7} />
          </span>
        </div>
      </Link>
    </li>
  );
}
