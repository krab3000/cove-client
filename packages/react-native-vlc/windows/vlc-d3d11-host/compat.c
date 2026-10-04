/* What VLC's libcompat provides to its plugins on Windows, for the sources
 * the module shares with VLC (compat/aligned_alloc.c). */
#ifdef HAVE_CONFIG_H
# include "config.h"
#endif

#include <errno.h>
#include <malloc.h>
#include <stdlib.h>

void *aligned_alloc(size_t align, size_t size)
{
    /* align must be a power of 2 */
    if (align == 0 || (align & (align - 1)) != 0)
    {
        errno = EINVAL;
        return NULL;
    }
    /* released with aligned_free (__mingw_aligned_free) */
    return __mingw_aligned_malloc(size, align);
}
