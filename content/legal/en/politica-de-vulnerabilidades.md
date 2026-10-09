## What it covers

- The Digital Brain extension for Claude Desktop, for Mac and Windows.
- The skeleton shipped inside it, in Spanish and English.
- The third-party components delivered with it: the embedded Python of the Windows extension, Gitea, the official Git, KeePassXC and Visual C++ installers, the Python dependencies and the packages in the MCP (Model Context Protocol) server catalogue.

Out of scope are Claude and third-party services (Anthropic, Holded, Gmail...), whose flaws are reported to them, and whatever each customer writes in their brain. A flaw in a component shipped with the extension is in scope: Pymatic Labs fixes it and informs whoever maintains it (Article 13(6) of Regulation (EU) 2024/2847).

## Security contact

Write to [info@pymaticlabs.com](mailto:info@pymaticlabs.com?subject=Security) with "Security" in the subject. Any other Pymatic Labs contact also works. This policy, security advisories and each version's component inventory are on this page, and the website's [security.txt](/.well-known/security.txt) file (RFC 9116) points here.

## How to report

The report includes:

1. The affected version (the extension's and the one in the brain's `esqueleto/VERSION` file) and the system, Mac or Windows.
2. What happens and how to reproduce it, step by step.
3. What someone exploiting it achieves (reading or changing data, running code...).
4. Whether someone is already exploiting it: this is the most urgent.
5. A contact, and whether you want to be credited in the public advisory.

No personal data or real passwords: a made-up example is enough. And do not publish the flaw until there is a fix or the disclosure deadline has passed.

## Good-faith research

If you research in good faith and follow this policy, Pymatic Labs will not take legal action against you for that research. Good faith means: testing only on your own Digital Brain installation; not accessing, changing or deleting other people's data beyond the minimum needed to show the flaw; not degrading any service; reporting without delay and not publishing early. This does not authorize testing on customers' computers or on third-party services (Anthropic, Stripe, GitHub and others), which have their own policies, and Pymatic Labs cannot authorize it on their behalf.

## Response targets

These are targets, not contractual deadlines; the only firm deadlines are the legal ones in the next section.

- Acknowledgement: within 2 business days.
- Initial assessment (whether it is a vulnerability, which versions it affects, severity): within 5 business days; the same day if there are signs someone is exploiting it.
- Fix, by Common Vulnerability Scoring System (CVSS) severity: critical or high, within 14 days; medium, within 30; low, in the next version and at most within 90.
- Coordinated disclosure: the public advisory comes out when the fix is available and, unless agreed otherwise with the reporter, at most 90 days after the report.

## What Pymatic Labs does

1. Assesses the report and logs it with its dates.
2. Fixes it in a fix release, separate from feature changes where possible, and free of charge.
3. Tells its customers about the fix and what they need to do.
4. Publishes an advisory for the fixed vulnerability on this page: what it is, affected versions, severity and how to fix it. If the risk calls for it, once customers have been able to update.
5. If the vulnerability is being actively exploited, or there is a severe incident affecting the product's security, it notifies INCIBE-CERT, the coordinating computer security incident response team (CSIRT) in Spain, through the single reporting platform of the European Union Agency for Cybersecurity (ENISA): early warning within 24 hours, notification within 72 hours and a final report 14 days after a fix is available (for a severe incident, one month after the notification). And it promptly tells affected customers what they can do in the meantime.

## Support period

Each version receives security fixes during its support period, whose end date is stated in its release notes and on the purchase page. Fixes go into the latest version, which every customer installs free of charge and at no extra cost, with or without a subscription.

> Pending: the length of each version's support period.

## Component inventory

Each version publishes its software bill of materials (SBOM) in CycloneDX format, machine-readable. It will be linked here with the first version released to customers.

## What this policy does not do

Reporting does not create a contract or entitle you to a reward: there is no bug bounty programme. This policy does not extend the warranties in the Digital Brain terms of use and sale. Personal data in a report is used only to handle it, under the Digital Brain privacy policy.
