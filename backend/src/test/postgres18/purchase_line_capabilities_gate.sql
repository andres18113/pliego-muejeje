\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE items JSONB;
BEGIN
  items := pliego.fn_purchase_item_capabilities('[
    {"format":"PAPERBACK","quantity":2,"title":"Físico"},
    {"format":"EBOOK","quantity":1,"title":"Digital"},
    {"format":"AUDIOBOOK","quantity":3,"title":"Reparación"},
    {"format":"HARDCOVER","quantity":1,"title":"Tapa dura"}
  ]'::JSONB);
  IF jsonb_array_length(items) <> 4
     OR items->0->>'title' <> 'Físico'
     OR items->0->>'requiresPhysicalFulfillment' <> 'true'
     OR items->0->>'quantityEditable' <> 'true'
     OR items->1->>'requiresPhysicalFulfillment' <> 'false'
     OR items->1->>'quantityEditable' <> 'false'
     OR items->2->>'requiresPhysicalFulfillment' <> 'false'
     OR items->2->>'quantityEditable' <> 'true'
     OR items->3->>'requiresPhysicalFulfillment' <> 'true'
     OR pliego.fn_purchase_item_capabilities('[]'::JSONB) <> '[]'::JSONB THEN
    RAISE EXCEPTION 'Purchase line capabilities must preserve DB classification, recovery and order';
  END IF;
END;
$$;
ROLLBACK;
