// netlify/functions/_shared/types.js
// @ts-check
//
// Shared JSDoc type aliases for the Netlify Functions that move money or decide
// access. Pure types, no runtime code — there is no @netlify/functions dependency
// in this project to import these from, so they're hand-written here to cover
// exactly what these functions read off the event and hand back as a response.
//
// Import with: /** @typedef {import("./types.js").NetlifyEvent} NetlifyEvent */

/**
 * The subset of the Netlify (AWS Lambda-shaped) request event these functions
 * actually read.
 * @typedef {Object} NetlifyEvent
 * @property {string} httpMethod
 * @property {Record<string, string | undefined>} headers
 * @property {string} [body]
 * @property {boolean} [isBase64Encoded]
 */

/**
 * The shape every handler in this directory returns.
 * @typedef {Object} NetlifyResponse
 * @property {number} statusCode
 * @property {Record<string, string>} [headers]
 * @property {string} body
 */

export {};
