// Build-time stub for better-sqlite3 (#10060).
//
// Aliased in for the Next.js production build (turbopack + webpack) so the
// bundler never pulls the real native addon into a build worker. The native
// Statement destructor aborts with SIGABRT when a build worker thread exits
// (assertion in node::RemoveEnvironmentCleanupHook, env == nullptr), which can
// leave the build with no standalone output. At runtime the real package is
// used (it is listed in serverExternalPackages, so it is require()'d natively,
// not bundled); this stub only stands in during the build, where the DB is
// never actually queried.
class Database {
  constructor() {}
  prepare() {
    return {
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
      get: () => undefined,
      all: () => [],
    };
  }
  exec() {}
  pragma() {}
  transaction(fn) {
    return fn;
  }
  backup() {
    return Promise.resolve({});
  }
  close() {}
}

module.exports = Database;
