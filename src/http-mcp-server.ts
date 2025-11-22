#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { SCBApiClient } from './api-client.js';
import fetch from 'node-fetch';
import express from 'express';

// Import the full SCBMCPServer class implementation from index.ts
// but adapt it for SSE transport instead of stdio
class SCBMCPServer {
  private server: Server;
  private scbClient: SCBApiClient;
  private ehealthClient: SCBApiClient;

  constructor() {
    this.server = new Server(
      {
        name: 'scb-mcp',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    // SCB Statistics Sweden API
    this.scbClient = new SCBApiClient('https://api.scb.se/OV0104/v2beta/api/v2');

    // E-hälsomyndigheten (Swedish eHealth Agency) Medicine Statistics API
    this.ehealthClient = new SCBApiClient('https://statistik.ehalsomyndigheten.se/api/v1');

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.getTools(),
      };
    });

    // List available resources (none for now)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [],
      };
    });

    // List available prompts (none for now)  
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'scb_get_api_status':
            return await this.handleGetApiStatus();

          case 'scb_browse_folders':
            return await this.handleBrowseFolders(args as any);

          case 'scb_search_tables':
            return await this.handleSearchTables(args as any);

          case 'scb_get_table_info':
            return await this.handleGetTableInfo(args as any);

          case 'scb_get_table_data':
            return await this.handleGetTableData(args as any);

          case 'scb_check_usage':
            return await this.handleCheckUsage();

          case 'scb_search_regions':
            return await this.handleSearchRegions(args as any);

          case 'scb_get_table_variables':
            return await this.handleGetTableVariables(args as any);

          case 'scb_find_region_code':
            return await this.handleFindRegionCode(args as any);

          case 'scb_test_selection':
            return await this.handleTestSelection(args as any);

          case 'scb_preview_data':
            return await this.handlePreviewData(args as any);

          // E-hälsomyndigheten Medicine Statistics
          case 'ehealth_search_tables':
            return await this.handleEhealthSearchTables(args as any);

          case 'ehealth_get_table_info':
            return await this.handleEhealthGetTableInfo(args as any);

          case 'ehealth_get_medicine_data':
            return await this.handleEhealthGetMedicineData(args as any);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'scb_get_api_status',
        description: 'Get API configuration and rate limit information from Statistics Sweden',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'scb_browse_folders',
        description: 'Browse the Statistics Sweden database structure by folders',
        inputSchema: {
          type: 'object',
          properties: {
            folderId: {
              type: 'string',
              description: 'Folder ID to browse (empty for root)',
            },
            language: {
              type: 'string',
              description: 'Language code (en, sv)',
              default: 'en',
            },
          },
        },
      },
      {
        name: 'scb_search_tables',
        description: 'Search for statistical tables in the SCB database',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search term (e.g., "population", "GDP", "Lerum"). Tip: Use specific terms like "population municipality" for demographics',
            },
            pastDays: {
              type: 'number',
              description: 'Only show tables updated in the last N days',
            },
            includeDiscontinued: {
              type: 'boolean',
              description: 'Include discontinued tables',
              default: false,
            },
            pageSize: {
              type: 'number',
              description: 'Number of results per page (max 100)',
              default: 20,
            },
            pageNumber: {
              type: 'number',
              description: 'Page number',
              default: 1,
            },
            language: {
              type: 'string',
              description: 'Language code (en, sv)',
              default: 'en',
            },
            category: {
              type: 'string',
              description: 'Filter by category: "population", "labour", "economy", "housing", etc.',
            },
          },
        },
      },
      {
        name: 'scb_get_table_info',
        description: 'Get detailed metadata about a specific statistical table',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: {
              type: 'string',
              description: 'Table ID (e.g., "BE0101N1")',
            },
            language: {
              type: 'string',
              description: 'Language code (en, sv)',
              default: 'en',
            },
          },
          required: ['tableId'],
        },
      },
      {
        name: 'scb_get_table_data',
        description: 'Get statistical data from a table with optional filtering',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: {
              type: 'string',
              description: 'Table ID (e.g., "BE0101N1")',
            },
            selection: {
              type: 'object',
              description: 'Variable selection (variable_name: [value1, value2]). Use * for all values, or expressions like "TOP(5)"',
              additionalProperties: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            language: {
              type: 'string',
              description: 'Language code (en, sv)',
              default: 'en',
            },
          },
          required: ['tableId'],
        },
      },
      {
        name: 'scb_check_usage',
        description: 'Check current API usage and rate limit status',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'scb_search_regions',
        description: 'Search for region codes by name (e.g., find code for "Lerum", "Stockholm")',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Region name to search for (e.g., "Lerum", "Stockholm")',
            },
            language: {
              type: 'string',
              description: 'Language code (en, sv)',
              default: 'en',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'scb_get_table_variables',
        description: 'Get available variables and their possible values for a table (essential before fetching data)',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: {
              type: 'string',
              description: 'Table ID (e.g., "TAB6534")',
            },
            language: {
              type: 'string',
              description: 'Language code (en, sv)',
              default: 'en',
            },
            variableName: {
              type: 'string',
              description: 'Optional: Show values for specific variable only (e.g., "region")',
            },
          },
          required: ['tableId'],
        },
      },
      {
        name: 'scb_find_region_code',
        description: 'Find the exact region code for a specific municipality or area (improved region lookup)',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Municipality or region name (e.g., "Lerum", "Stockholm", "Gothenburg")',
            },
            tableId: {
              type: 'string',
              description: 'Optional: Specific table to search for region codes (ensures compatibility)',
            },
            language: {
              type: 'string',
              description: 'Language code (en, sv)',
              default: 'en',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'scb_test_selection',
        description: 'Test if a data selection is valid without retrieving data (prevents API errors)',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: {
              type: 'string',
              description: 'Table ID (e.g., "TAB1267")',
            },
            selection: {
              type: 'object',
              description: 'Variable selection to test',
              additionalProperties: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            language: {
              type: 'string',
              description: 'Language code (en, sv)',
              default: 'en',
            },
          },
          required: ['tableId', 'selection'],
        },
      },
      {
        name: 'scb_preview_data',
        description: 'Get a small preview of data to verify selection works (safer than full data request)',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: {
              type: 'string',
              description: 'Table ID (e.g., "TAB1267")',
            },
            selection: {
              type: 'object',
              description: 'Variable selection (automatically limited to small sample)',
              additionalProperties: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            language: {
              type: 'string',
              description: 'Language code (en, sv)',
              default: 'en',
            },
          },
          required: ['tableId'],
        },
      },
      // E-hälsomyndigheten (Swedish eHealth Agency) Medicine Statistics Tools
      {
        name: 'ehealth_search_tables',
        description: 'Search medicine statistics tables from Swedish eHealth Agency (E-hälsomyndigheten). Available databases: "Detaljhandel med läkemedel" (retail sales), "Läkemedelsprisindex" (price index), "Sålda mängder läkemedelssubstanser" (environmental impact)',
        inputSchema: {
          type: 'object',
          properties: {
            database: {
              type: 'string',
              description: 'Database name: "Detaljhandel med läkemedel", "Läkemedelsprisindex", or "Sålda mängder läkemedelssubstanser med möjlig miljöpåverkan"',
              default: 'Detaljhandel med läkemedel',
            },
            language: {
              type: 'string',
              description: 'Language code (sv only)',
              default: 'sv',
            },
          },
        },
      },
      {
        name: 'ehealth_get_table_info',
        description: 'Get detailed information about a medicine statistics table including variables and available values',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: {
              type: 'string',
              description: 'Table ID (e.g., "LM1001" for total sales, "LM1002" for retail sales, "LM2001" for ATC classification)',
            },
            database: {
              type: 'string',
              description: 'Database name',
              default: 'Detaljhandel med läkemedel',
            },
            language: {
              type: 'string',
              description: 'Language code (sv only)',
              default: 'sv',
            },
          },
          required: ['tableId'],
        },
      },
      {
        name: 'ehealth_get_medicine_data',
        description: 'Get medicine statistics data (sales, DDD, packages, costs) from E-hälsomyndigheten. Returns national medicine data including sales method (prescription/OTC), drug groups, time periods, and measurements (cost, DDD, packages)',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: {
              type: 'string',
              description: 'Table ID (e.g., "LM1001")',
            },
            selection: {
              type: 'object',
              description: 'Variable selection. Common variables: försäljningssätt (0=OTC non-pharmacy, 1=OTC pharmacy, 2=Prescription, 3=Requisition), varugrupp (0=Human medicines, 1=External/natural, 2=Veterinary, 3=Trade goods), period (years or months), mätvärde (0=Cost excl VAT, 1=DDD, 2=DDD/TIN, 3=Packages, 4=Benefit cost, 5=Patient fee, 6=Extra cost)',
              additionalProperties: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            database: {
              type: 'string',
              description: 'Database name',
              default: 'Detaljhandel med läkemedel',
            },
            language: {
              type: 'string',
              description: 'Language code (sv only)',
              default: 'sv',
            },
          },
          required: ['tableId', 'selection'],
        },
      },
    ];
  }

  private async handleGetApiStatus() {
    const config = await this.scbClient.getConfig();
    const usage = this.scbClient.getUsageInfo();
    
    return {
      content: [
        {
          type: 'text',
          text: `**SCB API Status**

**Configuration:**
- API Version: ${config.apiVersion}
- Default Language: ${config.defaultLanguage}
- Available Languages: ${config.languages.map(l => `${l.id} (${l.label})`).join(', ')}
- Max Data Cells per Request: ${config.maxDataCells.toLocaleString()}
- Rate Limit: ${config.maxCallsPerTimeWindow} calls per ${config.timeWindow} seconds
- License: ${config.license}

**Current Usage:**
- Requests Made: ${usage.requestCount}/${usage.rateLimitInfo?.maxCalls || config.maxCallsPerTimeWindow}
- Remaining Requests: ${usage.rateLimitInfo?.remaining || 'Unknown'}
- Window Started: ${usage.windowStart.toISOString()}

${config.sourceReferences?.length ? `**Citation:**\n${config.sourceReferences.map(ref => `- ${ref.language}: ${ref.text}`).join('\n')}` : ''}`,
        },
      ],
    };
  }

  private async handleBrowseFolders(args: { folderId?: string; language?: string }) {
    const { folderId, language = 'en' } = args;

    // NOTE: The /navigation endpoint has been removed in SCB API v2
    // This feature is no longer available. Returning helpful error message.
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: {
              type: "feature_not_available",
              message: "The browse_folders feature is not available in SCB API v2",
              details: "The /navigation endpoint has been removed in PxWebApi 2.0",
              alternatives: [
                "Use scb_search_tables to find tables by keyword",
                "Search by category using the category parameter in scb_search_tables",
                "Browse tables by subject using the 'paths' field in search results"
              ],
              documentation: "https://www.scb.se/en/services/open-data-api/pxwebapi/pxapi-2.0",
              migration_notes: "PxWebApi 2.0 focuses on direct table search rather than folder navigation"
            }
          }, null, 2)
        },
      ],
    };
  }

  private async handleSearchTables(args: any) {
    const result = await this.scbClient.searchTables(args);
    
    // Filter by category if specified
    let filteredTables = result.tables;
    if (args.category) {
      const categoryLower = args.category.toLowerCase();
      filteredTables = result.tables.filter(table => {
        const labelLower = table.label.toLowerCase();
        const variablesLower = table.variableNames?.join(' ').toLowerCase() || '';
        
        switch (categoryLower) {
          case 'population':
            return labelLower.includes('population') || labelLower.includes('befolkning') || 
                   variablesLower.includes('region') || labelLower.includes('demographic');
          case 'labour':
            return labelLower.includes('labour') || labelLower.includes('employment') || 
                   labelLower.includes('arbete') || labelLower.includes('sysselsättning');
          case 'economy':
            return labelLower.includes('gdp') || labelLower.includes('income') || 
                   labelLower.includes('ekonomi') || labelLower.includes('bnp');
          case 'housing':
            return labelLower.includes('housing') || labelLower.includes('dwelling') || 
                   labelLower.includes('boende') || labelLower.includes('lägenhet');
          default:
            return true;
        }
      });
    }
    
    const displayTables = filteredTables.slice(0, args.pageSize || 20);
    
    // Transform to structured data
    const structuredData = {
      query: {
        search_term: args.query || null,
        category_filter: args.category || null,
        page_size: args.pageSize || 20,
        page_number: result.page.pageNumber,
        language: args.language || 'en'
      },
      tables: displayTables.map(table => ({
        id: table.id,
        title: table.label,
        description: table.description || null,
        period: {
          start: table.firstPeriod || null,
          end: table.lastPeriod || null
        },
        variables: table.variableNames || [],
        updated: table.updated || null,
        source: table.source || null,
        discontinued: table.discontinued || false,
        category: table.category || null
      })),
      pagination: {
        current_page: result.page.pageNumber,
        total_pages: result.page.totalPages,
        total_results: result.page.totalElements,
        page_size: result.page.pageSize
      },
      metadata: {
        total_filtered: filteredTables.length,
        total_unfiltered: result.tables.length,
        has_category_filter: !!args.category
      }
    };

    // Create user-friendly summary with better category filtering feedback
    let summary = `**🔍 Search Results** ${args.query ? `for "${args.query}"` : ''}${args.category ? ` (${args.category} category)` : ''}

**Found:** ${result.page.totalElements.toLocaleString()} tables${args.category ? ` (${filteredTables.length} match category filter)` : ''} (showing ${displayTables.length})

**Top Results:**`;

    if (displayTables.length === 0 && args.category && result.tables.length > 0) {
      // Category filter removed all results - provide helpful feedback
      summary += `

❌ **No tables match the "${args.category}" category filter**

The search found ${result.tables.length} table(s), but none match the "${args.category}" category criteria.

**💡 Suggestions:**
- Try removing the category filter: search without \`category="${args.category}"\`
- Use broader search terms like "${args.category}" instead of "${args.query}"
- Try related terms: ${args.category === 'population' ? '"befolkning", "demographic", or "region"' : `different ${args.category}-related terms`}

**🔍 What was found:**
${result.tables.slice(0, 3).map(table => `• ${table.label} (${table.id})`).join('\n')}${result.tables.length > 3 ? `\n• ... and ${result.tables.length - 3} more` : ''}`;
    } else if (displayTables.length > 0) {
      summary += `
${displayTables.slice(0, 5).map(table => 
  `📊 **${table.label}** (${table.id})
  - Period: ${table.firstPeriod} - ${table.lastPeriod}
  - Variables: ${(table.variableNames || []).slice(0, 3).join(', ')}${(table.variableNames?.length || 0) > 3 ? '...' : ''}
  - Updated: ${table.updated ? new Date(table.updated).toLocaleDateString() : 'N/A'}${table.discontinued ? ' ⚠️ DISCONTINUED' : ''}`
).join('\n\n')}`;
    }

    summary += `

📍 **Page ${result.page.pageNumber} of ${result.page.totalPages}**

${result.page.totalElements > 50 ? `💡 **Search Tips:**
- Try more specific terms: "${args.query || 'keyword'} municipality"
- Use category filters: population, labour, economy, housing
- Browse folders with \`scb_browse_folders\` for organized view` : ''}`;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(structuredData, null, 2)
        },
      ],
    };
  }

  private async handleGetTableInfo(args: { tableId: string; language?: string }) {
    const { tableId, language = 'en' } = args;
    const metadata = await this.scbClient.getTableMetadata(tableId, language);
    
    const variables = Object.entries(metadata.dimension).map(([varCode, varDef]) => {
      const valueCount = Object.keys(varDef.category.index).length;
      return `  **${varDef.label}** (${varCode}): ${valueCount} values`;
    }).join('\n');

    const totalCells = metadata.size.reduce((a, b) => a * b, 1);

    return {
      content: [
        {
          type: 'text',
          text: `**${metadata.label}** (${tableId})

**Dataset Information:**
- Source: ${metadata.source || 'Statistics Sweden'}
- Updated: ${metadata.updated ? new Date(metadata.updated).toLocaleDateString() : 'N/A'}
- Total Data Cells: ${totalCells.toLocaleString()}

**Variables:**
${variables}

**Contacts:**
${metadata.extension?.contact?.map(c => 
  `- ${c.name || 'N/A'}${c.mail ? ` (${c.mail})` : ''}${c.phone ? ` - ${c.phone}` : ''}`
).join('\n') || 'No contact information available'}

**Notes:**
${metadata.extension?.notes?.map(note => 
  `${note.mandatory ? '⚠️ ' : ''}${note.text}`
).join('\n') || 'No notes available'}`,
        },
      ],
    };
  }

  private async handleGetTableData(args: { tableId: string; selection?: Record<string, string[]>; language?: string }) {
    const { tableId, selection, language = 'en' } = args;
    const data = await this.scbClient.getTableData(tableId, selection, language);
    
    // Transform to structured JSON data
    const structuredData = this.scbClient.transformToStructuredData(data, selection);
    
    // Create user-friendly summary
    const summary = `**📊 Data Retrieved from ${tableId}**

**Table:** ${structuredData.metadata.table_name}
**Records:** ${structuredData.summary.total_records.toLocaleString()} data points
**Source:** ${structuredData.metadata.source}
**Updated:** ${structuredData.metadata.updated || 'Unknown'}

${selection ? `**Selection Applied:**
${Object.entries(selection).map(([key, values]) => `- ${key}: ${values.join(', ')}`).join('\n')}` : '**Full Dataset Retrieved**'}

**Data Preview:**
${structuredData.data.slice(0, 3).map(record => {
  const mainValue = record.value ? `Value: ${record.value}` : '';
  const otherFields = Object.entries(record)
    .filter(([key]) => key !== 'value')
    .map(([key, val]) => `${key}: ${val}`)
    .slice(0, 2)
    .join(', ');
  return `- ${otherFields}${mainValue ? `, ${mainValue}` : ''}`;
}).join('\n')}
${structuredData.data.length > 3 ? `... and ${(structuredData.data.length - 3).toLocaleString()} more records` : ''}`;
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(structuredData, null, 2)
        },
      ],
    };
  }

  private async handleCheckUsage() {
    const usage = this.scbClient.getUsageInfo();
    const rateLimitInfo = usage.rateLimitInfo;
    
    return {
      content: [
        {
          type: 'text',
          text: `**API Usage Status**

**Current Window:**
- Requests Made: ${usage.requestCount}
- Window Started: ${usage.windowStart.toISOString()}

${rateLimitInfo ? `**Rate Limits:**
- Max Calls: ${rateLimitInfo.maxCalls}
- Remaining: ${rateLimitInfo.remaining}
- Time Window: ${rateLimitInfo.timeWindow} seconds
- Reset Time: ${rateLimitInfo.resetTime.toISOString()}

**Usage:** ${usage.requestCount}/${rateLimitInfo.maxCalls} (${Math.round((usage.requestCount / rateLimitInfo.maxCalls) * 100)}%)` : '**Rate limit information not available yet**'}

${usage.requestCount > 0 ? `⚠️ **Tip:** To avoid rate limits, space out your requests and use specific selections to reduce API calls.` : ''}`,
        },
      ],
    };
  }

  private async handleSearchRegions(args: { query: string; language?: string }) {
    const { query, language = 'en' } = args;
    
    // Search for tables that contain region data to find region codes
    const searchResults = await this.scbClient.searchTables({
      query: `region ${query}`,
      pageSize: 5,
      lang: language
    });

    // Try to find region-related tables
    const regionTables = searchResults.tables.filter(table => 
      table.variableNames?.some(v => v.toLowerCase().includes('region')) ||
      table.label.toLowerCase().includes('region') ||
      table.label.toLowerCase().includes(query.toLowerCase())
    );

    if (regionTables.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `**Region Search for "${query}"**

❌ No region-specific tables found matching "${query}".

💡 **Suggestions:**
- Try searching for broader terms like "municipality" or "county"
- Browse the Population folder with \`scb_browse_folders\` 
- Look for tables with "region" in their variable names
- Try Swedish terms if using English doesn't work

🔍 **Common Swedish region terms:**
- "kommun" = municipality  
- "län" = county
- "riket" = the whole country`,
          },
        ],
      };
    }

    const recommendations = regionTables.slice(0, 3).map(table => 
      `📊 **${table.label}** (${table.id})
   📝 Variables: ${table.variableNames?.join(', ') || 'N/A'}
   💡 Use \`scb_get_table_info\` to see available regions`
    ).join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `**Region Search for "${query}"**

Found ${regionTables.length} tables that might contain region data for "${query}":

${recommendations}

💡 **Next steps:**
1. Use \`scb_get_table_info\` on one of these tables to see available regions
2. Look for region codes in the metadata  
3. Use the region code in your data selection

⚠️ **Note:** Region codes are typically numeric (e.g., "1484" for Lerum municipality)`,
        },
      ],
    };
  }

  private async handleGetTableVariables(args: { tableId: string; language?: string; variableName?: string }) {
    const { tableId, language = 'en', variableName } = args;
    
    try {
      // Get table metadata to extract variable information
      const metadata = await this.scbClient.getTableMetadata(tableId, language);
      
      if (!metadata.dimension) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                table_id: tableId,
                error: "No variable information available for this table",
                suggestion: "Try using scb_get_table_info for general table information"
              }, null, 2)
            },
          ],
        };
      }

      const variables = Object.entries(metadata.dimension);
      
      // Filter to specific variable if requested
      const filteredVariables = variableName 
        ? variables.filter(([code, def]) => 
            code.toLowerCase() === variableName.toLowerCase() ||
            def.label.toLowerCase().includes(variableName.toLowerCase())
          )
        : variables;

      if (filteredVariables.length === 0) {
        const availableVars = variables.map(([code, def]) => ({ code, label: def.label }));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                table_id: tableId,
                error: `Variable "${variableName}" not found`,
                available_variables: availableVars
              }, null, 2)
            },
          ],
        };
      }

      // Transform variables into structured JSON
      const variableData = filteredVariables.map(([varCode, varDef]) => {
        const values = Object.entries(varDef.category.index);
        const labels = varDef.category.label || {};
        
        // Get all values with their labels
        const allValues = values.map(([code, index]) => ({
          code,
          label: labels[code] || code,
          index
        }));
        
        return {
          variable_code: varCode,
          variable_name: varDef.label,
          variable_type: varCode.toLowerCase(),
          total_values: values.length,
          sample_values: allValues.slice(0, 10), // Show first 10 values
          has_more: values.length > 10,
          usage_example: {
            single_value: { [varCode]: [values[0]?.[0] || "value"] },
            multiple_values: { [varCode]: ["value1", "value2"] },
            all_values: { [varCode]: ["*"] },
            top_values: { [varCode]: ["TOP(5)"] }
          }
        };
      });

      const responseData = {
        table_id: tableId,
        table_name: metadata.label,
        query: {
          variable_filter: variableName || null,
          language
        },
        variables: variableData,
        metadata: {
          total_variables: variables.length,
          filtered_variables: filteredVariables.length,
          source: metadata.source || "Statistics Sweden",
          updated: metadata.updated
        }
      };

      const summary = `**🔍 Table Variables for ${tableId}**

**Table:** ${metadata.label}
${variableName ? `**Filtered for:** ${variableName}` : '**All Variables**'}

${variableData.map(v => 
  `**${v.variable_code}** (${v.variable_name})
  - Values: ${v.total_values.toLocaleString()}
  - Sample: ${v.sample_values.slice(0, 3).map(s => s.label).join(', ')}${v.has_more ? '...' : ''}
  - Usage: {"${v.variable_code}": ["${v.sample_values[0]?.code || 'value'}"]}
`).join('\n')}

💡 **Total Variables:** ${variables.length} available`;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(responseData, null, 2)
          },
        ],
      };
      
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: {
                type: "table_variables_failed",
                message: error instanceof Error ? error.message : String(error),
                table_id: tableId
              }
            }, null, 2)
          },
        ],
      };
    }
  }

  private async handleFindRegionCode(args: { query: string; tableId?: string; language?: string }) {
    const { query, tableId, language = 'en' } = args;
    
    try {
      let targetTableId: string;
      
      if (tableId) {
        // Use the specified table directly
        targetTableId = tableId;
      } else {
        // Look for a common population table that has region data
        const searchResults = await this.scbClient.searchTables({
          query: 'population municipality region',
          pageSize: 10,
          lang: language
        });

        // Find tables with Region variable
        const regionTables = searchResults.tables.filter(table => 
          table.variableNames?.some(v => v.toLowerCase().includes('region')) &&
          (table.label.toLowerCase().includes('population') || table.label.toLowerCase().includes('befolkning'))
        );

        if (regionTables.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query: query,
                matches: [],
                error: "No suitable regional tables found",
                common_codes: [
                  { code: "0180", name: "Stockholm" },
                  { code: "1480", name: "Gothenburg" },
                  { code: "1280", name: "Malmö" },
                  { code: "1484", name: "Lerum" },
                  { code: "0380", name: "Uppsala" }
                ],
                suggestion: "Use scb_search_regions to find relevant tables manually"
              }, null, 2)
            },
          ],
        };
        }

        // Use the first suitable table to get region information
        targetTableId = regionTables[0].id;
      }

      // Now use targetTableId (either specified or found)
      const metadata = await this.scbClient.getTableMetadata(targetTableId, language);
      
      if (!metadata.dimension || !metadata.dimension['Region']) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query: query,
                error: `Could not access region data from table ${targetTableId}`,
                suggestion: `Use scb_get_table_variables with tableId="${targetTableId}" to explore available regions manually`,
                source_table: targetTableId
              }, null, 2)
            },
          ],
        };
      }

      const regionDimension = metadata.dimension['Region'];
      const regionEntries = Object.entries(regionDimension.category.index);
      const regionLabels = regionDimension.category.label || {};

      // Search for the query in region labels and codes
      const exactMatches = regionEntries.filter(([code, index]) => {
        const label = regionLabels[code] || '';
        return label.toLowerCase().includes(query.toLowerCase()) ||
               code.toLowerCase().includes(query.toLowerCase());
      });

      if (exactMatches.length === 0) {
        // Do a fuzzy search for partial matches
        const partialMatches = regionEntries.filter(([code, index]) => {
          const label = regionLabels[code] || '';
          const queryWords = query.toLowerCase().split(' ');
          return queryWords.some(word => 
            label.toLowerCase().includes(word) || code.includes(word)
          );
        }).slice(0, 10);

        if (partialMatches.length === 0) {
          return {
            content: [
              {
                type: 'text', 
                text: JSON.stringify({
                  query: query,
                  matches: [],
                  error: `No regions found matching "${query}"`,
                  common_codes: [
                    { code: "0180", name: "Stockholm" },
                    { code: "1480", name: "Gothenburg (Göteborg)" },
                    { code: "1280", name: "Malmö" },
                    { code: "1484", name: "Lerum" },
                    { code: "0380", name: "Uppsala" }
                  ],
                  source_table: {
                    id: targetTableId,
                    name: metadata.label
                  },
                  suggestion: `Use scb_get_table_variables with tableId="${targetTableId}" and variableName="Region" to see all available regions`
                }, null, 2)
              },
            ],
          };
        }

        const partialResults = partialMatches.map(([code, index]) => ({
          code,
          name: regionLabels[code] || 'Unknown region',
          match_type: 'partial'
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query: query,
                matches: partialResults,
                match_type: 'partial_matches',
                primary_match: partialResults[0],
                usage_example: { Region: [partialResults[0].code] },
                source_table: {
                  id: targetTableId,
                  name: metadata.label
                }
              }, null, 2)
            },
          ],
        };
      }

      // Found exact or close matches
      const exactResults = exactMatches.slice(0, 5).map(([code, index]) => ({
        code,
        name: regionLabels[code] || 'Unknown region',
        match_type: 'exact'
      }));

      const structuredData = {
        query: query,
        matches: exactResults,
        match_type: 'exact_matches',
        total_matches: exactMatches.length,
        primary_match: exactResults[0],
        usage_example: { Region: [exactResults[0].code] },
        source_table: {
          id: targetTableId,
          name: metadata.label
        }
      };

      const summary = `**🎯 Region Code Found for "${query}"**

✅ **Primary Match:** ${exactResults[0].code} - ${exactResults[0].name}

**All Matches:**
${exactResults.map(r => `- **${r.code}**: ${r.name}`).join('\n')}

💡 **Usage Example:** \`{"Region": ["${exactResults[0].code}"]}\`

📊 **Source:** ${metadata.label} (${targetTableId})${tableId ? '\n⚠️ **Note:** Searched in specified table for compatibility' : '\n💡 **Note:** Searched in default population table'}`;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredData, null, 2)
          },
        ],
      };

    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: {
                type: "region_search_failed",
                message: error instanceof Error ? error.message : String(error),
                query: query,
                fallback: "Try scb_search_regions to find relevant tables manually"
              }
            }, null, 2)
          },
        ],
      };
    }
  }

  private async handleTestSelection(args: { tableId: string; selection: Record<string, string[]>; language?: string }) {
    const { tableId, selection, language = 'en' } = args;
    
    try {
      // Use the existing validation logic
      const validation = await this.scbClient.validateSelection(tableId, selection, language);
      
      const statusIcon = validation.isValid ? '✅' : '❌';
      const statusText = validation.isValid ? 'VALID' : 'INVALID';
      
      let responseText = `**Selection Validation for ${tableId}**

${statusIcon} **Status:** ${statusText}

**Your selection:**
${Object.entries(selection).map(([key, values]) => `- ${key}: [${values.join(', ')}]`).join('\n')}`;

      if (!validation.isValid) {
        responseText += `\n\n**❌ Errors:**\n${validation.errors.map(e => `- ${e}`).join('\n')}`;
      }

      if (validation.suggestions.length > 0) {
        responseText += `\n\n**💡 Suggestions:**\n${validation.suggestions.map(s => `- ${s}`).join('\n')}`;
      }

      if (validation.translatedSelection && JSON.stringify(validation.translatedSelection) !== JSON.stringify(selection)) {
        responseText += `\n\n**🔄 Translated selection:**\n${Object.entries(validation.translatedSelection).map(([key, values]) => `- ${key}: [${values.join(', ')}]`).join('\n')}`;
      }

      if (validation.isValid) {
        responseText += `\n\n**✅ This selection should work with \`scb_get_table_data\` or \`scb_preview_data\`!**`;
      } else {
        responseText += `\n\n**🔧 Fix the errors above before requesting data.**`;
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `**Selection Test Failed**

❌ Could not validate selection: ${error instanceof Error ? error.message : String(error)}

💡 Check that the table ID is correct and try again.`,
          },
        ],
      };
    }
  }

  private async handlePreviewData(args: { tableId: string; selection?: Record<string, string[]>; language?: string }) {
    const { tableId, selection, language = 'en' } = args;
    
    try {
      // Create a limited selection for preview
      let previewSelection = selection;
      
      if (selection) {
        // Limit each variable to at most 3 values or use special expressions
        previewSelection = {};
        for (const [key, values] of Object.entries(selection)) {
          if (values.some(v => v === '*' || v.startsWith('TOP(') || v.startsWith('BOTTOM('))) {
            // Replace * with TOP(3) for preview, keep other expressions
            previewSelection[key] = values.map(v => v === '*' ? 'TOP(3)' : v);
          } else {
            // Limit to first 3 values
            previewSelection[key] = values.slice(0, 3);
          }
        }
      }

      // Get a small sample of data
      const data = await this.scbClient.getTableData(tableId, previewSelection, language);
      
      // Transform to structured JSON data with preview flag
      const structuredData = this.scbClient.transformToStructuredData(data, previewSelection);
      
      // Add preview metadata
      const previewData = {
        ...structuredData,
        preview_info: {
          is_preview: true,
          original_selection: selection,
          preview_selection: previewSelection,
          note: "This is a limited preview. Use scb_get_table_data for full dataset."
        }
      };

      const summary = `**👀 Data Preview for ${tableId}**

**Table:** ${structuredData.metadata.table_name}
**Preview Records:** ${structuredData.summary.total_records.toLocaleString()} data points (limited sample)

${selection ? `**Original Selection:**
${Object.entries(selection).map(([key, values]) => `- ${key}: ${values.join(', ')}`).join('\n')}

**Preview Selection:**
${Object.entries(previewSelection || {}).map(([key, values]) => `- ${key}: ${values.join(', ')}`).join('\n')}` : '**Full Dataset Preview**'}

**Sample Data:**
${structuredData.data.slice(0, 5).map(record => {
  const mainValue = record.value ? `Value: ${record.value}` : '';
  const otherFields = Object.entries(record)
    .filter(([key]) => key !== 'value')
    .map(([key, val]) => `${key}: ${val}`)
    .slice(0, 2)
    .join(', ');
  return `- ${otherFields}${mainValue ? `, ${mainValue}` : ''}`;
}).join('\n')}

✅ **Preview looks good!** Use \`scb_get_table_data\` for the complete dataset.`;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(previewData, null, 2)
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: {
                type: "preview_failed",
                message: error instanceof Error ? error.message : String(error),
                troubleshooting: [
                  "Use scb_test_selection to validate your selection first",
                  "Check variable names with scb_get_table_variables", 
                  "Verify region codes with scb_find_region_code"
                ]
              }
            }, null, 2)
          },
        ],
      };
    }
  }

  // E-hälsomyndigheten handlers
  private async handleEhealthSearchTables(args: { database?: string; language?: string }) {
    const { database = 'Detaljhandel med läkemedel', language = 'sv' } = args;

    try {
      const encodedDb = encodeURIComponent(database);
      const url = `${this.ehealthClient['baseUrl']}/${language}/${encodedDb}/`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch tables: ${response.statusText}`);
      }

      const html = await response.text();

      // Parse table links from HTML
      const tableMatches = html.matchAll(/href="[^"]*\/-\/([^"]+\.px)\/"/g);
      const tables = Array.from(tableMatches, match => match[1].replace('.px', ''));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              database,
              available_tables: tables,
              count: tables.length,
              usage_hint: `Use ehealth_get_table_info with tableId (e.g., "${tables[0]}") to see variables and data`,
              common_tables: {
                LM1001: 'Total försäljning (Total sales)',
                LM1002: 'Detaljhandel (Retail sales)',
                LM2001: 'ATC-klassificering (ATC classification)'
              }
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error)
            }, null, 2)
          }
        ]
      };
    }
  }

  private async handleEhealthGetTableInfo(args: { tableId: string; database?: string; language?: string }) {
    const { tableId, database = 'Detaljhandel med läkemedel', language = 'sv' } = args;

    try {
      const encodedDb = encodeURIComponent(database);
      const url = `${this.ehealthClient['baseUrl']}/${language}/${encodedDb}/${tableId}.px`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SCB-MCP-Client/2.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch table metadata: ${response.statusText}`);
      }

      const metadata = await response.json() as any;

      // Format for better readability
      const formattedInfo = {
        table_id: tableId,
        title: metadata.title,
        variables: metadata.variables.map((v: any) => ({
          code: v.code,
          text: v.text,
          value_count: v.values.length,
          sample_values: v.values.slice(0, 5).map((val: string, idx: number) => ({
            code: val,
            label: v.valueTexts[idx]
          })),
          all_value_labels: v.values.length <= 20 ? v.valueTexts : undefined
        })),
        usage_example: {
          tool: 'ehealth_get_medicine_data',
          selection: Object.fromEntries(
            metadata.variables.slice(0, 2).map((v: any) => [v.code, [v.values[0]]])
          )
        }
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formattedInfo, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              tableId,
              hint: 'Use ehealth_search_tables first to find available table IDs'
            }, null, 2)
          }
        ]
      };
    }
  }

  private async handleEhealthGetMedicineData(args: {
    tableId: string;
    selection: Record<string, string[]>;
    database?: string;
    language?: string
  }) {
    const { tableId, selection, database = 'Detaljhandel med läkemedel', language = 'sv' } = args;

    try {
      const encodedDb = encodeURIComponent(database);
      const url = `${this.ehealthClient['baseUrl']}/${language}/${encodedDb}/${tableId}.px`;

      // Build query in PX-Web format
      const query = {
        query: Object.entries(selection).map(([code, values]) => ({
          code,
          selection: {
            filter: 'item',
            values
          }
        })),
        response: {
          format: 'json'
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'SCB-MCP-Client/2.0'
        },
        body: JSON.stringify(query)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as any;

      // Transform to structured format
      const structuredData = {
        query: {
          table_id: tableId,
          database,
          selection,
          requested_at: new Date().toISOString()
        },
        metadata: data.metadata?.[0] || {},
        columns: data.columns || [],
        data_records: data.data?.map((record: any) => {
          const obj: any = {};
          record.key.forEach((keyVal: string, idx: number) => {
            const column = data.columns[idx];
            obj[`${column.code}_code`] = keyVal;
            // Try to find label
            const varIdx = data.columns.findIndex((c: any) => c.code === column.code);
            if (varIdx >= 0) {
              obj[`${column.code}_label`] = keyVal; // Could be enhanced with actual labels
            }
          });
          obj.value = record.values[0];
          return obj;
        }) || [],
        summary: {
          total_records: data.data?.length || 0,
          has_data: (data.data?.length || 0) > 0
        }
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredData, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: {
                type: 'data_fetch_failed',
                message: error instanceof Error ? error.message : String(error),
                troubleshooting: [
                  'Use ehealth_get_table_info to see available variables',
                  'Check that variable codes match exactly (case-sensitive)',
                  'Ensure value codes are valid for the selected variables'
                ]
              }
            }, null, 2)
          }
        ]
      };
    }
  }

  getServer(): Server {
    return this.server;
  }
}

// Express app for SSE transport
const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// CORS - open for all
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.1.0',
    service: 'SCB MCP Server (SSE)',
    protocol: 'MCP over SSE',
    tools: 14,
    documentation: 'https://github.com/KSAklfszf921/scb-mcp'
  });
});

// Create MCP server instance
const mcpServer = new SCBMCPServer();

// SSE endpoint for MCP
app.get('/sse', async (req, res) => {
  console.log('📡 New SSE connection from:', req.ip);

  const transport = new SSEServerTransport('/message', res);
  await mcpServer.getServer().connect(transport);

  console.log('✅ SSE transport connected');
});

// POST endpoint for MCP messages
app.post('/message', async (req, res) => {
  // SSE transport handles this
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`🚀 SCB MCP Server (SSE) running on port ${PORT}`);
  console.log(`📡 SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`💊 Protocol: MCP over Server-Sent Events`);
  console.log(`🔧 Health check: http://localhost:${PORT}/health`);
  console.log(`\n✅ All 14 tools available via MCP protocol`);
  console.log(`   - 11 SCB tools (Statistics Sweden)`);
  console.log(`   - 3 E-hälsomyndigheten tools (Medicine statistics)`);
  console.log(`\n💡 No authentication required - just connect via SSE!`);
});
