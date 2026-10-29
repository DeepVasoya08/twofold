/**
 * Lets Node run the backup tool's TypeScript straight from source: workspace packages import
 * their own files without the .ts extension, which a bundler resolves but Node doesn't.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /^\.{1,2}\//.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    throw error;
  }
}
