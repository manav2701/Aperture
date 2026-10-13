-- Grants for the private-beta waitlist. The table is global and holds no org data, so it needs
-- no row-level security (like stable_prices in 0013). UPDATE is for marking an entry invited;
-- nothing deletes a row, so an entry cannot be quietly dropped from the list.
GRANT SELECT, INSERT, UPDATE ON waitlist_signups TO aperture_app;
