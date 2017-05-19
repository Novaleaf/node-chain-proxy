/**
 * group1: subdomain
 * group2: domain.ext
 * exclude short domains (length < 4) to avoid catching double extensions (ex: net.au, co.uk, ...)
 */
declare const HOSTNAME_REGEX: RegExp;
