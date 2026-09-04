import { scrapeOpenStreetMap, scrapeOpenStreetMapWorld } from '../src/scraper-openstreetmap.js';

const scenarios = [
  { name: 'Brasil', query: 'pizzaria em Campinas, SP', search: scrapeOpenStreetMap },
  { name: 'All World', query: 'pizza in Los Angeles, USA', search: scrapeOpenStreetMapWorld }
];

for (const scenario of scenarios) {
  const results = await scenario.search(scenario.query, { maxResults: 50 });
  console.log(JSON.stringify({ scenario: scenario.name, query: scenario.query, count: results.length, phones: results.filter((lead) => lead.whatsappPhone).length, sites: results.filter((lead) => lead.website).length, sample: results.slice(0, 2) }, null, 2));
  if (!results.length) process.exitCode = 1;
}
