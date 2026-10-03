import { lookupLocationMap } from './lookupLocationMap.js';
import { fetchVerifiedLink } from './fetchVerifiedLink.js';

export const tools = {
  lookup_location_map: lookupLocationMap,
  fetch_verified_link: fetchVerifiedLink,
};

export const toolSchemas = [
  {
    type: "function",
    function: {
      name: "lookup_location_map",
      description: "Looks up geographic coordinates and details for a given location",
      parameters: {
        type: "object",
        properties: {
          location_name: { type: "string", maxLength: 200 },
          city_context: { type: "string", maxLength: 100 }
        },
        required: ["location_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_verified_link",
      description: "Finds verified official links for a given query",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", maxLength: 200 }
        },
        required: ["query"]
      }
    }
  }
];
