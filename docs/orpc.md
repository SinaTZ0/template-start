# oRPC

> Build APIs that are typesafe end to end, with OpenAPI included

## Docs

- [Getting Started](https://orpc.dev/docs/getting-started): Build your first end-to-end typesafe API with oRPC, from defining procedures to serving and calling them from a client.
- [Contract-First](https://orpc.dev/docs/contract-first): Build your first contract-first API with oRPC: describe the API in a contract, implement it with full type checking, and call it from a client that only needs the contract.
- [Comparison](https://orpc.dev/docs/comparison): See how oRPC compares to tRPC and Hono across type safety, OpenAPI support, framework integrations, and runtime performance.
- [Runtime Requirements](https://orpc.dev/docs/requirements): oRPC is built on ES2022 and a small set of standard Web APIs. This page lists exactly what it needs and the minimum versions that provide it on Node.js, Deno, Bun, Cloudflare Workers, browsers, Android, and iOS.
- [Ecosystem](https://orpc.dev/docs/ecosystem): Discover libraries, integrations, and community projects that extend oRPC across frameworks, runtimes, and tooling.
- [Playgrounds](https://orpc.dev/docs/playgrounds): Try oRPC instantly with pre-configured playground examples for Bun, Cloudflare, NestJS, Next.js, and Expo on StackBlitz or locally.
- [API Reference](https://orpc.dev/docs/api-reference): Full signatures for every function, class, and type the oRPC packages export.
- [Procedure](https://orpc.dev/docs/procedure): Learn how oRPC procedures combine input and output validation, middleware, metadata, and typesafe errors through a composable builder.
- [Router](https://orpc.dev/docs/router): Organize oRPC procedures into nestable routers, extend them with shared middleware, lazy-load routes, and infer their types.
- [Middleware](https://orpc.dev/docs/middleware): Run code before and after oRPC handlers with composable middleware that can inject context, guard access, and modify input or output.
- [Context](https://orpc.dev/docs/context): Use oRPC context for type-safe dependency injection, providing initial context explicitly or injecting values through middleware.
- [Error Handling](https://orpc.dev/docs/error-handling): Handle errors in oRPC with the ORPCError class, typesafe error definitions, reusable error factories, and custom error conversion.
- [Binary Data](https://orpc.dev/docs/binary-data): Learn how oRPC procedures accept and return File, Blob, and binary streams, and how to configure CORS headers for cross-origin binary responses.
- [AsyncIteratorObject (SSE)](https://orpc.dev/docs/async-iterator-object): Stream realtime typesafe data from oRPC procedures with async generators, event validation, resume support, and cleanup on disconnect.
- [Metadata](https://orpc.dev/docs/metadata): Attach metadata to oRPC procedures with defineMeta or a custom MetaPlugin so middleware, plugins, and tooling can read it to control behavior.

### RPC

- [RPC Protocol](https://orpc.dev/docs/rpc/protocol): Learn how the RPC protocol routes procedure calls, encodes input and output beyond plain JSON, and formats success and error responses.
- [RPC Serializer](https://orpc.dev/docs/rpc/serializer): Learn how RPC Serializers encode data between client and server, supporting types beyond plain JSON such as Date, BigInt, Set, Map, and custom classes.
- [RPC Handler](https://orpc.dev/docs/rpc/handler): Use RPCHandler to serve procedures over the RPC protocol, with HTTP method control, interceptors, plugins, custom serializers, and error responses.
- [RPC Link](https://orpc.dev/docs/rpc/link): Use RPCLink to call RPC Handler servers or any server implementing the RPC protocol, with headers, interceptors, plugins, and custom serializers.

### OpenAPI

- [OpenAPI Routing](https://orpc.dev/docs/openapi/routing): Use openapi metadata to control how procedures are exposed over HTTP, including methods, paths, path parameters, and prefixes.
- [OpenAPI Input and Output Mapping](https://orpc.dev/docs/openapi/input-and-output-mapping): Learn how oRPC maps OpenAPI requests and responses to procedure inputs and outputs with compact and detailed structures, parameter styles, and body hints.
- [Bracket Notation](https://orpc.dev/docs/openapi/bracket-notation): Learn how bracket notation encodes structured data like nested objects and arrays in flat key-value formats such as query strings and form data.
- [OpenAPI Serializer](https://orpc.dev/docs/openapi/serializer): Learn how OpenAPI Serializer performs one-way serialization of complex types like Date, BigInt, and files into JSON-friendly formats, and how to customize it.
- [OpenAPI Handler](https://orpc.dev/docs/openapi/handler): Use OpenAPIHandler to expose oRPC procedures as HTTP endpoints for OpenAPI Link and other OpenAPI-compliant clients.
- [OpenAPI Link](https://orpc.dev/docs/openapi/link): Use OpenAPILink to call HTTP endpoints served by OpenAPI Handler or any OpenAPI-compliant server through a typesafe oRPC client.
- [OpenAPI Specification](https://orpc.dev/docs/openapi/specification): Learn how to configure openapi metadata and generate OpenAPI 3.2, 3.1, or 3.0 documents from your oRPC contracts and routers with OpenAPIGenerator.
- [Scalar (Swagger)](https://orpc.dev/docs/openapi/scalar): Use Scalar to serve an interactive API reference UI for your oRPC API generated from its OpenAPI specification.
- [Expanding Type Support for OpenAPI Link](https://orpc.dev/docs/openapi/expanding-type-support-for-link): Restore native types like Date and bigint on OpenAPI Link clients using the Response Validation or Smart Coercion plugins.
- [OpenAPI Link Without Runtime Imports](https://orpc.dev/docs/openapi/link-without-runtime-imports): Use build-time macros to embed a minified contract in your client bundle, so OpenAPI Link works without maintaining a separate contract or shipping server code to the client.

### Contract

- [Procedure Contract](https://orpc.dev/docs/contract/procedure): Define procedure contracts that describe input, output, errors, and metadata without business logic, keeping implementations aligned.
- [Router Contract](https://orpc.dev/docs/contract/router): Define router contracts that describe the shape of a router without business logic, useful for documentation, testing, and aligned implementations.
- [Contract Implementation](https://orpc.dev/docs/contract/implementation): Learn how to implement a contract with the implement function, adding type-checked handlers, middleware, and routers to every procedure.
- [Generate Contract from OpenAPI](https://orpc.dev/docs/contract/generate-from-openapi): Generate an oRPC contract from an existing OpenAPI specification with Hey API's orpc plugin instead of writing it by hand.
- [Contract Client Factory](https://orpc.dev/docs/contract/client-factory): Create clients from individual procedure contracts instead of a single root contract, keeping large oRPC codebases fast and decoupled.

### Client

- [Server-Side Clients](https://orpc.dev/docs/client/server-side): Call oRPC procedures locally in the same process with call, createRouterClient, or the callable extension, ideal for server-side code.
- [Client-Side Clients](https://orpc.dev/docs/client/client-side): Create oRPC clients that call procedures remotely over a link, with client context, interceptors, and type inference utilities.
- [Client Error Handling](https://orpc.dev/docs/client/error-handling): Handle client-side errors in oRPC with try/catch, or use safe and createSafeClient for fully type-inferred typesafe errors.
- [AsyncIteratorObject in Client](https://orpc.dev/docs/client/async-iterator-object): Consume an AsyncIteratorObject from the client like an AsyncGenerator, with stream cancellation, error handling, and event metadata.
- [DynamicLink](https://orpc.dev/docs/client/dynamic-link): Use DynamicLink to choose a link at runtime and route different oRPC requests through different links based on client context.

### Adapters

- [Fetch API Adapter](https://orpc.dev/docs/adapters/fetch-api): Use oRPC with the Fetch API on both servers and clients, in runtimes such as Bun and Deno.
- [Node HTTP Adapter](https://orpc.dev/docs/adapters/node-http): Use oRPC with Node HTTP, HTTPS, and HTTP2 servers via RPCHandler or OpenAPIHandler, with CORS and event stream options.
- [AWS Lambda Adapter](https://orpc.dev/docs/adapters/aws-lambda): Use oRPC on AWS Lambda behind API Gateway (payload formats 1.0 and 2.0) and Lambda Function URLs using response streaming.
- [Fastify Adapter](https://orpc.dev/docs/adapters/fastify): Use oRPC with Fastify servers via RPCHandler or OpenAPIHandler, with content type parser tips and event stream options.
- [WebSocket Adapters](https://orpc.dev/docs/adapters/websocket): Use oRPC over WebSocket for low-latency, full-duplex communication, with adapters for ws, crossws, Bun, Deno, Cloudflare, and uWebSockets.
- [Message Port Adapter](https://orpc.dev/docs/adapters/message-port): Use oRPC over the Message Port API to communicate between contexts such as iframes, web workers, and service workers.
- [Astro Adapter](https://orpc.dev/docs/adapters/astro): Use oRPC inside an Astro project by mounting a handler in an API route.
- [Browser Adapter](https://orpc.dev/docs/adapters/browser): Use oRPC for typesafe communication between browser scripts via the Message Port Adapter.
- [Cloudflare Workers Adapter](https://orpc.dev/docs/adapters/cloudflare-workers): Use oRPC on Cloudflare Workers through the Fetch API Adapter, with the compatibility flags that make request cancellation and unhandled rejections behave.
- [Electron Adapter](https://orpc.dev/docs/adapters/electron): Use oRPC for typesafe communication between Electron processes via the Message Port Adapter.
- [Elysia Adapter](https://orpc.dev/docs/adapters/elysia): Use oRPC inside an Elysia project by mounting a handler on a wildcard route.
- [Expo Adapter](https://orpc.dev/docs/adapters/expo): Use oRPC in an Expo app over fetch or WebSocket, including streaming support, binary data, and the SDK versions each feature needs.
- [Express.js Adapter](https://orpc.dev/docs/adapters/express): Use oRPC inside an Express.js project by mounting a handler as a middleware.
- [H3 Adapter](https://orpc.dev/docs/adapters/h3): Use oRPC inside an H3 project by mounting a handler on a wildcard route.
- [Hono Adapter](https://orpc.dev/docs/adapters/hono): Use oRPC inside a Hono project by mounting a handler as a middleware.
- [Next.js Adapter](https://orpc.dev/docs/adapters/next): Use oRPC inside a Next.js project by mounting a handler in a route handler.
- [Nuxt Adapter](https://orpc.dev/docs/adapters/nuxt): Use oRPC inside a Nuxt project by mounting a handler in a server route.
- [React Router Adapter](https://orpc.dev/docs/adapters/react-router): Use oRPC inside a React Router project by mounting a handler in a resource route.
- [SolidStart Adapter](https://orpc.dev/docs/adapters/solid-start): Use oRPC inside a SolidStart project by mounting a handler in an API route.
- [SvelteKit Adapter](https://orpc.dev/docs/adapters/svelte-kit): Use oRPC inside a SvelteKit project by mounting a handler in an endpoint.
- [TanStack Start Adapter](https://orpc.dev/docs/adapters/tanstack-start): Use oRPC inside a TanStack Start project by mounting a handler in a server route.
- [Web Workers Adapter](https://orpc.dev/docs/adapters/web-workers): Use oRPC for typesafe communication with Web Workers via the Message Port Adapter.
- [Worker Threads Adapter](https://orpc.dev/docs/adapters/worker-threads): Use oRPC for typesafe communication between Node.js Worker Threads via the Message Port Adapter.

### Plugins

- [Batch Plugin](https://orpc.dev/docs/plugins/batch): Combine multiple requests into a single batch and receive their responses together, reducing the overhead of separate requests.
- [Batch Response Compression Plugin](https://orpc.dev/docs/plugins/batch-response-compression): Compress batch responses when you know their contents compress, flushing each one as it is ready so a streaming batch stays streaming.
- [CORS Handler Plugin](https://orpc.dev/docs/plugins/cors): Configure CORS policy for your oRPC API with CORSHandlerPlugin, including allowed origins, methods, and exposed headers.
- [Dedupe Plugin](https://orpc.dev/docs/plugins/dedupe): Prevent redundant requests by deduplicating similar in-flight requests, reducing the number of requests sent to the server.
- [GET Method CSRF Protection Plugin](https://orpc.dev/docs/plugins/get-method-csrf-protection): Use GetMethodCsrfProtectionHandlerPlugin to make the safe GET method as secure as POST by rejecting navigations that may carry SameSite=Lax cookies from another site.
- [Method Override Plugin](https://orpc.dev/docs/plugins/method-override): Use MethodOverrideHandlerPlugin to override the HTTP method of a POST request with a query parameter, so HTML forms can invoke PUT, PATCH, and DELETE procedures.
- [OpenAPI Reference Plugin (Swagger/Scalar)](https://orpc.dev/docs/plugins/openapi-reference): Serve interactive API reference documentation powered by Scalar or Swagger UI and expose your OpenAPI specification as JSON.
- [Prototype Pollution Protection Plugin](https://orpc.dev/docs/plugins/prototype-pollution-protection): Use PrototypePollutionProtectionHandlerPlugin to reject request input carrying **proto** or constructor.prototype keys before it reaches your procedures.
- [Request Compression Plugin](https://orpc.dev/docs/plugins/request-compression): Compress request bodies on the client and decompress them on the server to reduce bandwidth usage for large payloads.
- [Request Headers Plugin](https://orpc.dev/docs/plugins/request-headers): Expose incoming request headers as context.reqHeaders with RequestHeadersHandlerPlugin for easy access in procedures.
- [Request Limit Plugin](https://orpc.dev/docs/plugins/request-limit): Restrict the size of incoming request bodies with RequestLimitHandlerPlugin to protect your server from oversized payloads.
- [Request Validation Plugin](https://orpc.dev/docs/plugins/request-validation): Validate requests against your contract on the client before sending them to the server, catching invalid input early.
- [Response Compression Plugin](https://orpc.dev/docs/plugins/response-compression): Compress response bodies on the server and decompress them on the client to reduce bandwidth usage and improve performance.
- [Response Headers Plugin](https://orpc.dev/docs/plugins/response-headers): Use ResponseHeadersHandlerPlugin to set response headers and cookies via context.resHeaders and merge them into the final response.
- [Response Validation Plugin](https://orpc.dev/docs/plugins/response-validation): Validate server responses against your contract on the client, ensuring returned data matches the types your contract defines.
- [Rethrow Handler Plugin](https://orpc.dev/docs/plugins/rethrow): Bypass oRPC's built-in error handling and rethrow matching errors to your framework, such as NestJS filters or Express error middleware.
- [Retry Plugin](https://orpc.dev/docs/plugins/retry): Automatically retry failed oRPC requests with customizable strategies controlled through client context options.
- [Retry After Plugin](https://orpc.dev/docs/plugins/retry-after): Automatically retry requests based on the Retry-After response header, useful for rate limits and temporary server unavailability.
- [Smart Coercion Plugin](https://orpc.dev/docs/plugins/smart-coercion): Automatically coerce request and response values to match your schema types without writing manual coercion logic.
- [Static File Plugin](https://orpc.dev/docs/plugins/static-file): Serve static files alongside your procedures, with ETag caching, range requests, single page application fallback, and directory traversal protection.
- [Timeout Plugin](https://orpc.dev/docs/plugins/timeout): Abort requests that exceed a timeout on the client or the server, using a static value or a per-request dynamic timeout.
- [Tmp File Upload Plugin](https://orpc.dev/docs/plugins/tmp-file-upload): Stream large file uploads into temporary files instead of memory, so requests far larger than available memory are parsed safely.

### Helpers

- [Base64Url Helpers](https://orpc.dev/docs/helpers/base64url): Encode and decode URL-safe base64url strings with oRPC helpers, useful for web tokens, data serialization, and APIs.
- [Cookie Helpers](https://orpc.dev/docs/helpers/cookie): Set, read, and delete HTTP cookies from fetch Headers with oRPC cookie helpers, and secure them with signing or encryption.
- [Encryption Helpers](https://orpc.dev/docs/helpers/encryption): Encrypt and decrypt sensitive data in oRPC using AES-GCM with PBKDF2 key derivation via the encrypt and decrypt helpers.
- [Form Data Helpers](https://orpc.dev/docs/helpers/form-data): Parse HTML form data and extract validation error messages with bracket notation support for complex nested structures.
- [Lock Helpers](https://orpc.dev/docs/helpers/lock): Prevent the same work from running concurrently in oRPC with a unified Locker interface, storage adapters, and procedure middleware.
- [Publisher Helpers](https://orpc.dev/docs/helpers/publisher): Publish and subscribe to events across storage backends in oRPC, with adapters, dynamic event names, and resume support for missed events.
- [Rate Limit Helpers](https://orpc.dev/docs/helpers/ratelimit): Add rate limiting to oRPC with a unified RateLimiter interface, storage adapters, procedure middleware, and a handler plugin for HTTP headers.
- [Signing Helpers](https://orpc.dev/docs/helpers/signing): Cryptographically sign and verify data with HMAC-SHA256 using oRPC signing helpers, a faster alternative to encryption.

### Integrations

- [AI SDK Integration](https://orpc.dev/docs/integrations/ai-sdk): Learn how to use oRPC as a transport for AI SDK streams and turn oRPC procedures and contracts into AI SDK tools.
- [ArkType Integration](https://orpc.dev/docs/integrations/arktype): Use ArkType types directly in oRPC via Standard Schema, with a dedicated JSON Schema converter for OpenAPI generation and Smart Coercion.
- [Better Auth Integration](https://orpc.dev/docs/integrations/better-auth): Use Better Auth sessions in oRPC context and protect procedures with typed middleware.
- [Cloudflare Workers Traces Integration](https://orpc.dev/docs/integrations/cloudflare-traces): Record oRPC procedure, middleware, and stream spans in Cloudflare Workers Traces through the Workers custom spans API, with no OpenTelemetry SDK.
- [Effect Integration](https://orpc.dev/docs/integrations/effect): Write effectful oRPC handlers with Effect generators, call oRPC clients as effects, provide services through context, and use Effect Schema for input and output validation.
- [Evlog Integration](https://orpc.dev/docs/integrations/evlog): Add structured logging to oRPC with the Evlog integration to trace requests, monitor errors, and inspect application behavior.
- [Hibernation Integration](https://orpc.dev/docs/integrations/hibernation): Learn how oRPC integrates with Hibernation APIs like Cloudflare's WebSocket Hibernation so servers can sleep without dropping connections.
- [MSW Integration](https://orpc.dev/docs/integrations/msw): Mock oRPC procedures at the network level with typed MSW request handlers, reusing the real RPC or OpenAPI runtime for serialization and validation.
- [Implement oRPC contract with NestJS](https://orpc.dev/docs/integrations/nest): Learn how to implement oRPC contracts in NestJS with the @orpc/nest package while keeping type safety and OpenAPI compatibility.
- [Next.js Integration](https://orpc.dev/docs/integrations/next): Use oRPC in Next.js applications with server functions, form actions, and React hooks for optimistic updates and typesafe error handling.
- [OpenTelemetry Integration](https://orpc.dev/docs/integrations/opentelemetry): Add automatic OpenTelemetry instrumentation to oRPC for distributed tracing and performance monitoring across client and server.
- [Pinia Colada Integration](https://orpc.dev/docs/integrations/pinia-colada): Use oRPC clients with Pinia Colada through utilities for building query and mutation options, keys, and typesafe error handling.
- [Pino Integration](https://orpc.dev/docs/integrations/pino): Add structured logging to oRPC with the Pino integration to track requests, monitor errors, and gain insight into application behavior.
- [Standard Schema Integration](https://orpc.dev/docs/integrations/standard-schema): Use Zod, Valibot, ArkType, or any Standard Schema library with oRPC, plus automatic JSON Schema conversion via Standard JSON Schema.
- [SWR Integration](https://orpc.dev/docs/integrations/swr): Use oRPC with SWR through lightweight key, fetcher, subscriber, and mutator helpers for data fetching, subscriptions, and mutations in React.
- [TanStack AI Integration](https://orpc.dev/docs/integrations/tanstack-ai): Learn how to use oRPC as a transport for TanStack AI chat streams, through the oRPC client or as a plain Server-Sent Events endpoint.
- [TanStack Query Integration](https://orpc.dev/docs/integrations/tanstack-query): Integrate oRPC with TanStack Query using utilities for query and mutation options, keys, infinite and streamed queries, and typesafe errors.
- [tRPC Integration](https://orpc.dev/docs/integrations/trpc): Learn how to integrate tRPC with oRPC by converting tRPC routers into oRPC routers and bridging metadata between the two.
- [Valibot Integration](https://orpc.dev/docs/integrations/valibot): Use Valibot schemas directly in oRPC via Standard Schema, with a dedicated JSON Schema converter for OpenAPI generation and Smart Coercion.
- [Zod Integration](https://orpc.dev/docs/integrations/zod): Use Zod schemas directly in oRPC via Standard Schema, with a dedicated JSON Schema converter and registries for customizing generated schemas.

### Recipes

- [Testing and Mocking](https://orpc.dev/docs/recipes/testing-and-mocking): Learn how to test oRPC procedures directly with server-side clients, create mock implementations with the implementer, and mock network requests with MSW.
- [Validation Customization](https://orpc.dev/docs/recipes/validation-customization): Learn how to customize validation in oRPC, including disabling runtime validation and shaping custom validation errors.
- [Monorepo Setup](https://orpc.dev/docs/recipes/monorepo-setup): Set up a monorepo with oRPC using TypeScript project references to keep end-to-end type safety across interconnected apps and packages.
- [Publish Client to NPM](https://orpc.dev/docs/recipes/publish-client-to-npm): Learn how to build and publish your oRPC client to NPM so users can consume your APIs as a fully typed SDK.
- [Optimizing Server-Side Rendering (SSR) for Fullstack Frameworks](https://orpc.dev/docs/recipes/optimizing-ssr): Optimize server-side rendering with oRPC in Next.js, Nuxt, and SvelteKit by calling API logic directly and avoiding extra HTTP requests.
- [Dedupe Middleware](https://orpc.dev/docs/recipes/dedupe-middleware): Learn how to use context to prevent the same middleware from repeating expensive work when it runs multiple times in a single call.
- [No Throw Literal](https://orpc.dev/docs/recipes/no-throw-literal): Learn why oRPC recommends throwing only Error instances and how to customize this behavior with ThrowableError in the Registry.
- [Exceeds the Maximum Length Problem](https://orpc.dev/docs/recipes/exceeds-the-maximum-length-problem): Fix the TypeScript error where an inferred router type exceeds the maximum length the compiler will serialize.

### Migrations

- [Migrating from oRPC v1](https://orpc.dev/docs/migrations/from-v1): Upgrade an oRPC v1 app to v2, with side-by-side v1 and v2 comparisons for every change that needs your attention.
- [Migrating from tRPC](https://orpc.dev/docs/migrations/from-trpc): Migrate an existing tRPC app to oRPC step by step. Most tRPC concepts map directly, so routers, procedures, and middleware feel familiar.

## RSS Feeds

- [oRPC — Blog](https://orpc.dev/blog/rss.xml)
