﻿

# what

hard port of ```node-http-mitm-proxy``` (v0.5.2)  https://www.npmjs.com/package/http-mitm-proxy 

# why
We used ```node-http-mitm-proxy``` but issue support + bugfixes is slow.  That combined with the use of archaic ES3 style classes nessesitated a rewrite which we can support and add features to.

# New features *(done)*
- Written in Typescript (integral type Definitions and ES6 classes).  Still works with legacy ES3 environments.
- add user defined "tags" object to ctx.  Example:  ```ctx.tags.myKey="my value";```
- add url to context (ease of use).  Example: ```console.log(ctx.url.href);```
- customize the CA via ```listenOptions.sslCaName``` (only used when CA cert doesn't exist, IE at first run).  Example:  ```proxy.listen({ port, keepAlive: true, forceSNI: true, timeout: 60000, sslCaName:"My Special Proxy" });```

# ToDo
- add onAuth callback to Proxy object (auth ignored if not set)
- allow api to be used with Promises (currently callback only)
- remove usage of async library in favor of Bluebird (Promises)
- Forward HTTPS requests to upstream proxy without expensive MITM layer.  (**help requested!**)
- Continued feature parity with https://www.npmjs.com/package/http-mitm-proxy : *bugfixes / feature ports as added to the  code or issue tracker*
- get inspiration from https://github.com/alibaba/anyproxy

# long term goals
Expect the codebase to diverge from ```node-http-mitm-proxy``` over time due to the following goals:
- focus is on improving performance and features for relaying https requests to an upstream proxy.  
- simplify, document, and better moduarlize the proxy subsystems
- When possible, we will manually integrate patches from ```node-http-mitm-proxy``` into this codebase.  (Applying Pull requests isn't possible due to refactoring to Typescript/ES6)


# install

```bash
npm install --save chain-proxy
```

# example

```typescript
import Proxy = require("chain-proxy");
let proxy = new Proxy();
//see ```node-htt-mitm-proxy``` example....
```

# usage

currently is a superset of https://github.com/joeferner/node-http-mitm-proxy so read it's docs/readme for general usage.   

will rewrite docs later when/if api diverges. 

# license

MIT

# credits

- code written by JasonS <aat> novaleaf <doot coom>
- original module from Joe Ferner.  see https://github.com/joeferner/node-http-mitm-proxy