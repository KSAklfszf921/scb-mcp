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
    version: '2.0.0',
    service: 'SCB MCP Server (HTTP)',
    authentication: 'none'
  });
});

// MCP info endpoint - INGEN AUTENTISERING KRÄVS
app.get('/mcp', (req, res) => {
  res.json({
    protocol: 'mcp',
    version: '2.0.0',
    name: 'SCB & E-hälsomyndigheten Statistics Server',
    description: 'Swedish statistics and medicine data - No authentication required',
    capabilities: {
      tools: true,
      resources: false,
      prompts: false
    },
    tools: {
      scb: [
        'scb_get_api_status',
        'scb_search_tables',
        'scb_get_table_info',
        'scb_get_table_data',
        'scb_check_usage',
        'scb_search_regions',
        'scb_get_table_variables',
        'scb_find_region_code',
        'scb_test_selection',
        'scb_preview_data',
        'scb_browse_folders'
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
      format: 'JSON',
      example: {
        tool: 'ehealth_get_medicine_data',
        arguments: {
          tableId: 'LM1001',
          selection: {
            'försäljningssätt': ['2'],
            'varugrupp': ['0'],
            'period': ['4'],
            'mätvärde': ['0', '1', '3']
          }
        }
      }
    }
  });
});

// MCP tool call endpoint - INGEN AUTENTISERING KRÄVS
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

    // SCB tools
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
    } else if (tool === 'scb_search_tables') {
      const searchResult = await scbClient.searchTables(args || {});
      result = {
        tables: searchResult.tables.slice(0, 20),
        total: searchResult.tables.length
      };
    } else if (tool === 'scb_get_table_info') {
      if (!args?.tableId) {
        throw new Error('tableId required');
      }
      result = await scbClient.getTableMetadata(args.tableId, args.language || 'en');
    }
    // E-hälsomyndigheten tools
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
    } else if (tool === 'ehealth_get_table_info') {
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
    } else if (tool === 'ehealth_get_medicine_data') {
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
    } else {
      return res.status(404).json({
        error: `Unknown tool: ${tool}`,
        available_tools: [
          'scb_get_api_status',
          'scb_search_tables',
          'scb_get_table_info',
          'ehealth_search_tables',
          'ehealth_get_table_info',
          'ehealth_get_medicine_data'
        ]
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
  console.log(`\n✅ Ready for Render deployment!`);
});
