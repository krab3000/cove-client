#pragma once

// C++ conveniences over rntrace.h: a category handle, an RAII span, and macros that compile to nothing with
// RNTRACE_DISABLED defined.
//
//   static const rntrace::Category kCategory("mpv");
//   RNTRACE_SCOPE(kCategory, "decode packet");                 // until the end of the scope
//   RNTRACE_SCOPE(kCategory, "decode packet", "size", 4096);   // with an argument
//   RNTRACE_COUNTER(kCategory, "frames queued", 3, track);

#include <cstdint>
#include <string>

#include "rntrace.h"

namespace rntrace {

class Category {
 public:
  explicit Category(const char *name) : m_category(rntrace_category_get(name)) {}
  bool Enabled() const { return rntrace_enabled(m_category) != 0; }
  const rntrace_category *get() const { return m_category; }

 private:
  const rntrace_category *m_category;
};

class Scope {
 public:
  Scope(const Category &category, const char *name) : m_category(category.Enabled() ? category.get() : nullptr) {
    if (m_category)
      rntrace_begin(m_category, name);
  }
  Scope(const Category &category, const char *name, const char *key, int64_t value)
      : m_category(category.Enabled() ? category.get() : nullptr) {
    if (m_category)
      rntrace_begin_arg(m_category, name, key, value);
  }
  Scope(const Category &category, const char *name, const char *key, const char *value)
      : m_category(category.Enabled() ? category.get() : nullptr) {
    if (m_category)
      rntrace_begin_str(m_category, name, key, value);
  }
  ~Scope() {
    if (m_category)
      rntrace_end(m_category);
  }
  Scope(const Scope &) = delete;
  Scope &operator=(const Scope &) = delete;

 private:
  const rntrace_category *m_category;
};

} // namespace rntrace

#define RNTRACE_CONCAT_(a, b) a##b
#define RNTRACE_CONCAT(a, b) RNTRACE_CONCAT_(a, b)

#if defined(RNTRACE_DISABLED)
#define RNTRACE_SCOPE(category, ...) ((void)0)
#define RNTRACE_ASYNC_BEGIN(category, name, track) ((void)0)
#define RNTRACE_ASYNC_END(category, track) ((void)0)
#define RNTRACE_INSTANT(category, name, track) ((void)0)
#define RNTRACE_COUNTER(category, name, value, track) ((void)0)
#else
#define RNTRACE_SCOPE(category, ...) ::rntrace::Scope RNTRACE_CONCAT(rntrace_scope_, __LINE__)(category, __VA_ARGS__)
#define RNTRACE_ASYNC_BEGIN(category, name, track)                                                                  \
  do {                                                                                                              \
    if ((category).Enabled())                                                                                       \
      rntrace_async_begin((category).get(), name, track);                                                           \
  } while (0)
#define RNTRACE_ASYNC_END(category, track)                                                                          \
  do {                                                                                                              \
    if ((category).Enabled())                                                                                       \
      rntrace_async_end((category).get(), track);                                                                   \
  } while (0)
#define RNTRACE_INSTANT(category, name, track)                                                                      \
  do {                                                                                                              \
    if ((category).Enabled())                                                                                       \
      rntrace_instant((category).get(), name, track);                                                               \
  } while (0)
#define RNTRACE_COUNTER(category, name, value, track)                                                               \
  do {                                                                                                              \
    if ((category).Enabled())                                                                                       \
      rntrace_counter((category).get(), name, double(value), track);                                                \
  } while (0)
#endif
