const xmlEscape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
    .replaceAll('"', "&quot;");

/**
 * A Gmail filter export (Settings, Filters, Import filters): mail from any bank sender is forwarded
 * to the user's address, kept out of spam and labelled.
 */
export function gmailFilterXml(options: {
  senders: readonly string[];
  forwardTo: string;
  label: string;
}) {
  const property = (name: string, value: string) =>
    `    <apps:property name='${name}' value='${xmlEscape(value)}'/>`;
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    "<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>",
    "  <title>Mail Filters</title>",
    "  <entry>",
    "    <category term='filter'></category>",
    `    <title>${xmlEscape(options.label)}</title>`,
    "    <content></content>",
    property("from", options.senders.join(" OR ")),
    property("forwardTo", options.forwardTo),
    property("shouldNeverSpam", "true"),
    property("label", options.label),
    "  </entry>",
    "</feed>",
    "",
  ].join("\n");
}
