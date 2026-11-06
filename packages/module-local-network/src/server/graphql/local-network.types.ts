import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('LocalNetworkCertificate')
export class LocalNetworkCertificateType {
  /** PEM, re-encoded from the parsed certificate: never the file's own bytes. */
  @Field()
  pem!: string;

  /** Colon-separated upper-case hex. */
  @Field()
  sha256!: string;

  /** The same form; what Windows shows as "Thumbprint". */
  @Field()
  sha1!: string;

  @Field()
  subject!: string;

  /** ISO-8601. */
  @Field()
  expiresAt!: string;
}

@ObjectType('LocalNetwork')
export class LocalNetworkType {
  /** `ready`, `certificate_missing` or `origin_invalid`. */
  @Field()
  state!: string;

  /** What to do, when `state` is not `ready`. */
  @Field(() => String, { nullable: true })
  problem!: string | null;

  @Field(() => String, { nullable: true })
  appUrl!: string | null;

  @Field(() => String, { nullable: true })
  certificateUrl!: string | null;

  @Field(() => LocalNetworkCertificateType, { nullable: true })
  certificate!: LocalNetworkCertificateType | null;
}
