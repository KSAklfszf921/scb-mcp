#!/usr/bin/env node

import express from 'express';
import { SCBApiClient } from './api-client.js';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

// CORS - öppen för alla, INGEN AUTENTISERING
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

// Initialize API clients
const scbClient = new SCBApiClient('https://api.scb.se/OV0104/v2beta/api/v2');
const ehealthClient = new SCBApiClient('https://statistik.ehalsomyndigheten.se/api/v1');

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.1.0',
    service: 'SCB MCP Server (HTTP) - Complete',
    authentication: 'none',
    tools: {
      scb: 11,
      ehealth: 3,
      total: 14
    }
  });
});

// MCP info endpoint
app.get('/mcp', (req, res) => {
  res.json({
    protocol: 'mcp',
    version: '2.1.0',
    name: 'SCB & E-hälsomyndigheten Statistics Server',
    description: 'Swedish statistics and medicine data - No authentication required - COMPLETE with all 14 tools',
    authentication: 'none',
    capabilities: {
      tools: true,
      resources: false,
      prompts: false
    },
    tools: {
      scb: [
        'scb_get_api_status',
        'scb_browse_folders',
        'scb_search_tables',
        'scb_get_table_info',
        'scb_get_table_data', // ✅
        'scb_check_usage', // ✅
        'scb_search_regions', // ✅
        'scb_get_table_variables', // ✅
        'scb_find_region_code', // ✅
        'scb_test_selection', // ✅
        'scb_preview_data' // ✅
      ],
      ehealth: [
        'ehealth_search_tables',
        'ehealth_get_table_info',
        'ehealth_get_medicine_data'
      ]
    },
    usage: {
      endpoint: '/mcp/call',
      method: 'POST',
      format: 'JSON'
    }
  });
});

// MCP tool call endpoint - ALLA 14 VERKTYG
app.post('/mcp/call', async (req, res) => {
  try {
    const { tool, arguments: args } = req.body;

    if (!tool) {
      return res.status(400).json({
        error: 'Missing tool name',
        usage: 'POST /mcp/call with {tool: "tool_name", arguments: {...}}'
      });
    }

    let result;

    // =================================================================
    // SCB TOOLS (11)
    // =================================================================

    if (tool === 'scb_get_api_status') {
      const config = await scbClient.getConfig();
      const usage = scbClient.getUsageInfo();
      result = {
        api_version: config.apiVersion,
        max_data_cells: config.maxDataCells,
        rate_limit: {
          max_calls: config.maxCallsPerTimeWindow,
          time_window: config.timeWindow,
          remaining: usage.rateLimitInfo?.remaining || 0,
          resets_at: usage.rateLimitInfo?.resetTime || new Date(),
        }
      };
    }

    else if (tool === 'scb_search_tables') {
      const searchResult = await scbClient.searchTables(args || {});
      result = {
        tables: searchResult.tables.slice(0, 20).map(t => ({
          id: t.id,
          label: t.label,
          first_period: t.firstPeriod,
          last_period: t.lastPeriod,
          updated: t.updated,
          variables: t.variableNames
        })),
        total: searchResult.tables.length,
        page: searchResult.page
      };
    }

    else if (tool === 'scb_get_table_info') {
      if (!args?.tableId) {
        throw new Error('tableId required');
      }
      const metadata = await scbClient.getTableMetadata(args.tableId, args.language || 'en');
      result = {
        table_id: args.tableId,
        label: metadata.label,
        source: metadata.source,
        updated: metadata.updated,
        size: metadata.size,
        dimensions: Object.entries(metadata.dimension).map(([code, dim]: [string, any]) => ({
          code,
          label: dim.label,
          value_count: Object.keys(dim.category.index).length
        }))
      };
    }

    // ✅ NEW: scb_get_table_data
    else if (tool === 'scb_get_table_data') {
      if (!args?.tableId) {
        throw new Error('tableId required');
      }
      const data = await scbClient.getTableData(args.tableId, args.selection, args.language || 'en');
      const structured = scbClient.transformToStructuredData(data, args.selection);
      result = structured;
    }

    // ✅ NEW: scb_check_usage
    else if (tool === 'scb_check_usage') {
      const usage = scbClient.getUsageInfo();
      result = {
        request_count: usage.requestCount,
        window_start: usage.windowStart,
        rate_limit: usage.rateLimitInfo ? {
          max_calls: usage.rateLimitInfo.maxCalls,
          remaining: usage.rateLimitInfo.remaining,
          time_window: usage.rateLimitInfo.timeWindow,
          reset_time: usage.rateLimitInfo.resetTime
        } : null
      };
    }

    // ✅ NEW: scb_search_regions
    else if (tool === 'scb_search_regions') {
      if (!args?.query) {
        throw new Error('query required');
      }
      const searchResults = await scbClient.searchTables({
        query: `region ${args.query}`,
        pageSize: 10,
        lang: args.language || 'en'
      });
      const regionTables = searchResults.tables.filter(t =>
        t.variableNames?.some((v: string) => v.toLowerCase().includes('region'))
      );
      result = {
        query: args.query,
        tables: regionTables.slice(0, 5).map(t => ({
          id: t.id,
          label: t.label,
          variables: t.variableNames
        })),
        total: regionTables.length
      };
    }

    // ✅ NEW: scb_get_table_variables
    else if (tool === 'scb_get_table_variables') {
      if (!args?.tableId) {
        throw new Error('tableId required');
      }
      const metadata = await scbClient.getTableMetadata(args.tableId, args.language || 'en');
      const variables = Object.entries(metadata.dimension).map(([code, dim]: [string, any]) => {
        const values = Object.entries(dim.category.label || {}).map(([valCode, label]) => ({
          code: valCode,
          label
        }));
        return {
          variable_code: code,
          variable_name: dim.label,
          total_values: values.length,
          sample_values: values.slice(0, 10),
          usage_example: { [code]: [values[0]?.code] }
        };
      });
      result = {
        table_id: args.tableId,
        variables,
        metadata: {
          table_name: metadata.label,
          source: metadata.source,
          updated: metadata.updated
        }
      };
    }

    // ✅ NEW: scb_find_region_code
    else if (tool === 'scb_find_region_code') {
      if (!args?.query) {
        throw new Error('query required');
      }

      let targetTableId = args.tableId;

      if (!targetTableId) {
        const searchResults = await scbClient.searchTables({
          query: 'population municipality region',
          pageSize: 10,
          lang: args.language || 'en'
        });
        const regionTables = searchResults.tables.filter(t =>
          t.variableNames?.some((v: string) => v.toLowerCase().includes('region')) &&
          (t.label.toLowerCase().includes('population') || t.label.toLowerCase().includes('befolkning'))
        );
        if (regionTables.length > 0) {
          targetTableId = regionTables[0].id;
        }
      }

      if (!targetTableId) {
        result = {
          query: args.query,
          matches: [],
          error: 'No suitable regional tables found',
          common_codes: [
            { code: '0180', name: 'Stockholm' },
            { code: '1480', name: 'Gothenburg' },
            { code: '1280', name: 'Malmö' },
            { code: '1484', name: 'Lerum' }
          ]
        };
      } else {
        const metadata = await scbClient.getTableMetadata(targetTableId, args.language || 'en');
        const regionDim = metadata.dimension?.['Region'];

        if (!regionDim) {
          result = {
            query: args.query,
            error: 'No region dimension found',
            source_table: targetTableId
          };
        } else {
          const regionLabels = regionDim.category.label || {};
          const matches = Object.entries(regionLabels)
            .filter(([code, label]: [string, any]) =>
              label.toLowerCase().includes(args.query.toLowerCase()) ||
              code.toLowerCase().includes(args.query.toLowerCase())
            )
            .map(([code, label]) => ({
              code,
              name: label,
              match_type: label.toLowerCase() === args.query.toLowerCase() ? 'exact' : 'partial'
            }))
            .slice(0, 10);

          result = {
            query: args.query,
            matches,
            source_table: targetTableId,
            usage_example: matches.length > 0 ? { Region: [matches[0].code] } : null
          };
        }
      }
    }

    // ✅ NEW: scb_test_selection
    else if (tool === 'scb_test_selection') {
      if (!args?.tableId || !args?.selection) {
        throw new Error('tableId and selection required');
      }
      // Validate selection by getting metadata
      const metadata = await scbClient.getTableMetadata(args.tableId, args.language || 'en');
      const issues: any[] = [];
      const valid_variables: any = {};

      Object.entries(args.selection).forEach(([varCode, values]: [string, any]) => {
        if (!metadata.dimension[varCode]) {
          issues.push({
            variable: varCode,
            issue: 'Variable not found in table',
            available: Object.keys(metadata.dimension)
          });
        } else {
          const dim = metadata.dimension[varCode];
          const validCodes = Object.keys(dim.category.label || {});
          const invalidValues = values.filter((v: string) => !validCodes.includes(v));

          if (invalidValues.length > 0) {
            issues.push({
              variable: varCode,
              issue: 'Invalid value codes',
              invalid_values: invalidValues,
              sample_valid: validCodes.slice(0, 5)
            });
          } else {
            valid_variables[varCode] = values;
          }
        }
      });

      result = {
        table_id: args.tableId,
        selection: args.selection,
        is_valid: issues.length === 0,
        issues,
        valid_variables,
        recommendation: issues.length > 0 ?
          'Use scb_get_table_variables to see available variables and values' :
          'Selection is valid, ready for scb_get_table_data'
      };
    }

    // ✅ NEW: scb_preview_data
    else if (tool === 'scb_preview_data') {
      if (!args?.tableId) {
        throw new Error('tableId required');
      }

      // Get metadata to create a small preview selection
      const metadata = await scbClient.getTableMetadata(args.tableId, args.language || 'en');
      let previewSelection = args.selection || {};

      // If no selection provided, create one with first value of each dimension
      if (Object.keys(previewSelection).length === 0) {
        previewSelection = Object.entries(metadata.dimension).reduce((acc, [code, dim]: [string, any]) => {
          const firstValue = Object.keys(dim.category.label || {})[0];
          if (firstValue) {
            acc[code] = [firstValue];
          }
          return acc;
        }, {} as Record<string, string[]>);
      }

      // Limit selection to max 2 values per dimension for preview
      const limitedSelection = Object.entries(previewSelection).reduce((acc, [key, values]: [string, any]) => {
        acc[key] = values.slice(0, 2);
        return acc;
      }, {} as Record<string, string[]>);

      const data = await scbClient.getTableData(args.tableId, limitedSelection, args.language || 'en');
      const structured = scbClient.transformToStructuredData(data, limitedSelection);

      result = {
        ...structured,
        preview_info: {
          is_preview: true,
          limited_selection: limitedSelection,
          note: 'This is a preview with limited data. Use scb_get_table_data for full dataset'
        }
      };
    }

    // scb_browse_folders
    else if (tool === 'scb_browse_folders') {
      result = {
        error: 'browse_folders endpoint removed in API v2',
        alternative: 'Use scb_search_tables with category filters instead',
        categories: ['population', 'labour', 'economy', 'housing', 'education']
      };
    }

    // =================================================================
    // E-HÄLSOMYNDIGHETEN TOOLS (3)
    // =================================================================

    else if (tool === 'ehealth_search_tables') {
      const database = args?.database || 'Detaljhandel med läkemedel';
      const encodedDb = encodeURIComponent(database);
      const url = `https://statistik.ehalsomyndigheten.se/api/v1/sv/${encodedDb}/`;

      const response = await fetch(url);
      const html = await response.text();

      const tableMatches = html.matchAll(/href="[^"]*\/-\/([^"]+\.px)\/"/g);
      const tables = Array.from(tableMatches, match => match[1].replace('.px', ''));

      result = {
        database,
        tables,
        count: tables.length,
        common_tables: {
          LM1001: 'Total försäljning',
          LM1002: 'Detaljhandel',
          LM2001: 'ATC-klassificering'
        }
      };
    }

    else if (tool === 'ehealth_get_table_info') {
      if (!args?.tableId) {
        throw new Error('tableId required');
      }

      const database = args.database || 'Detaljhandel med läkemedel';
      const encodedDb = encodeURIComponent(database);
      const url = `https://statistik.ehalsomyndigheten.se/api/v1/sv/${encodedDb}/${args.tableId}.px`;

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch table: ${response.statusText}`);
      }

      const metadata = await response.json() as any;

      result = {
        table_id: args.tableId,
        title: metadata.title,
        variables: metadata.variables.map((v: any) => ({
          code: v.code,
          text: v.text,
          value_count: v.values.length,
          sample_values: v.values.slice(0, 5).map((val: string, idx: number) => ({
            code: val,
            label: v.valueTexts[idx]
          }))
        }))
      };
    }

    else if (tool === 'ehealth_get_medicine_data') {
      if (!args?.tableId || !args?.selection) {
        throw new Error('tableId and selection required');
      }

      const database = args.database || 'Detaljhandel med läkemedel';
      const encodedDb = encodeURIComponent(database);
      const url = `https://statistik.ehalsomyndigheten.se/api/v1/sv/${encodedDb}/${args.tableId}.px`;

      const query = {
        query: Object.entries(args.selection).map(([code, values]) => ({
          code,
          selection: { filter: 'item', values }
        })),
        response: { format: 'json' }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(query)
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const data = await response.json() as any;

      result = {
        table_id: args.tableId,
        database,
        selection: args.selection,
        data_records: data.data?.map((record: any) => {
          const obj: any = {};
          record.key.forEach((keyVal: string, idx: number) => {
            const column = data.columns[idx];
            obj[`${column.code}_code`] = keyVal;
          });
          obj.value = record.values[0];
          return obj;
        }) || [],
        metadata: data.metadata?.[0] || {},
        summary: {
          total_records: data.data?.length || 0,
          has_data: (data.data?.length || 0) > 0
        }
      };
    }

    // =================================================================
    // UNKNOWN TOOL
    // =================================================================

    else {
      return res.status(404).json({
        error: `Unknown tool: ${tool}`,
        available_tools: {
          scb: ['scb_get_api_status', 'scb_browse_folders', 'scb_search_tables', 'scb_get_table_info',
                'scb_get_table_data', 'scb_check_usage', 'scb_search_regions', 'scb_get_table_variables',
                'scb_find_region_code', 'scb_test_selection', 'scb_preview_data'],
          ehealth: ['ehealth_search_tables', 'ehealth_get_table_info', 'ehealth_get_medicine_data']
        }
      });
    }

    res.json({
      tool,
      result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Tool call error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      tool: req.body.tool
    });
  }
});

// Start server
const port = parseInt(process.env.PORT || '3000');
app.listen(port, () => {
  console.log(`🚀 SCB MCP HTTP Server running on port ${port}`);
  console.log(`📡 MCP endpoint: http://localhost:${port}/mcp`);
  console.log(`🔧 Tool calls: http://localhost:${port}/mcp/call`);
  console.log(`💊 No authentication required - just use the URL!`);
  console.log(`\n✅ COMPLETE: All 14 tools implemented!`);
  console.log(`   - 11 SCB tools (including data retrieval, region search, preview)`);
  console.log(`   - 3 E-hälsomyndigheten tools (medicine statistics)`);
});
