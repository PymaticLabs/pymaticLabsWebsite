-- Almacen privado de la entrega. Sin politicas en storage.objects: solo el servidor (service_role)
-- sube y lee, y la zona da enlaces firmados que caducan en minutos. Nunca un enlace publico.
--
-- releases: versiones/<X.Y.Z>/<fichero> (extensiones de Mac y Windows, instalador del registro,
--   sus .sha256 y SBOM).
-- customer-files: facturas/<empresa>/<numero>.pdf y condiciones/<version>/<idioma>.html (la copia
--   de las condiciones que se aceptaron).

insert into storage.buckets (id, name, public)
values ('releases', 'releases', false), ('customer-files', 'customer-files', false)
on conflict (id) do nothing;
