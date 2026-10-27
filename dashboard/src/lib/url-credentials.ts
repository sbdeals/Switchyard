/** Remove URL userinfo without changing a repository path or scp-style Git URL. */
export function stripUrlCredentials(value: string): string {
  // Git's scp syntax uses a login name, not URL credentials: git@host:repo.git.
  if (/^[^\s:@/]+@[^\s:/]+:[^\s]*$/.test(value)) return value;

  // Work on the original text so round-tripped URLs retain their exact spelling.
  // Unlike URL(), this also handles incomplete/invalid hosts without leaking the
  // userinfo while the user repairs an invalid repository URL.
  const stripped = value.replace(/(^|[\s/])([a-z][a-z\d+.-]*:\/{1,2}|\/\/)([^/?#]*)/i,
    (match, prefix: string, scheme: string, authority: string) => {
      const at = authority.lastIndexOf("@");
      return at < 0 ? match : `${prefix}${scheme}${authority.slice(at + 1)}`;
    });
  // Only the leading authority of a malformed/schemeless address can contain
  // userinfo; colons and @ characters in a valid URL's path are ordinary text.
  return stripped.replace(/^(\s*)[^\s/@:]+:[^/@?#]*@/, "$1");
}

/** Preserve credentials when a settings form resubmits its redacted value. */
export function preserveUrlCredentials(submitted: string, stored: string | null): string {
  return stored && submitted === stripUrlCredentials(stored) ? stored : submitted;
}
