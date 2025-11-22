# Ändringslogg

Alla viktiga ändringar i projektet dokumenteras i denna fil.

## [2.2.0] - 2025-11-23

### Borttaget
- Alla E-hälsomyndigheten-verktyg (ehealth_search_tables, ehealth_get_table_info, ehealth_get_medicine_data)
- Fokuserar nu enbart på SCB-statistik

### Ändrat
- Servernamn från "SCB & E-hälsomyndigheten Statistics Server" till "SCB Statistics Server"
- Antal verktyg från 14 till 11
- Uppdaterade beskrivningar för att reflektera SCB-fokus

## [2.1.0] - 2025-11-22

### Tillagt
- Fullständigt MCP-protokollstöd med initialize och initialized metoder
- HTTP transport med CORS-stöd
- Express-baserad HTTP-server

### Fixat
- OAuth/autentiseringsfel med Claude Code
- MCP-handshake-protokoll nu korrekt implementerat

## [1.0.0] - 2025-11-20

### Tillagt
- Initial release
- 11 SCB-verktyg för statistikåtkomst
- Automatisk variabelöversättning
- Förhandsvalidering av queries
- Rate limiting enligt SCBs API-specifikation
