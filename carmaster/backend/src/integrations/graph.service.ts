import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@microsoft/microsoft-graph-client';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    name: string;
    contentType: string;
    contentBytes: string;
  }>;
}

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private normalizeValue(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  private async getAzureConfig() {
    const settings = await this.prisma.setting.findUnique({ where: { id: 1 } });
    const clientId = this.normalizeValue(settings?.azureClientId) || this.normalizeValue(this.configService.get<string>('AZURE_CLIENT_ID'));
    const clientSecret =
      this.normalizeValue(settings?.azureClientSecret) || this.normalizeValue(this.configService.get<string>('AZURE_CLIENT_SECRET'));
    const tenantId = this.normalizeValue(settings?.azureTenantId) || this.normalizeValue(this.configService.get<string>('AZURE_TENANT_ID'));

    return { clientId, clientSecret, tenantId };
  }

  private async getMsalClient() {
    const { clientId, clientSecret, tenantId } = await this.getAzureConfig();
    if (!clientId || !clientSecret || !tenantId) {
      throw new Error('Microsoft Graph is not configured');
    }
    return new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });
  }

  private async getToken() {
    const msalClient = await this.getMsalClient();
    const token = await msalClient.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });
    if (!token?.accessToken) throw new Error('Unable to get Graph access token');
    return token.accessToken;
  }

  async getClient() {
    const accessToken = await this.getToken();
    return Client.init({
      defaultVersion: 'v1.0',
      authProvider: (done) => {
        done(null, accessToken);
      },
    });
  }

  async sendMail(input: SendMailInput) {
    const sender = process.env.GRAPH_SENDER || process.env.AZURE_SENDER_USER;
    if (!sender) {
      this.logger.warn('GRAPH_SENDER is not set; skipping email send');
      return { skipped: true };
    }
    try {
      const client = await this.getClient();
      await client.api(`/users/${sender}/sendMail`).post({
        message: {
          subject: input.subject,
          body: { contentType: 'HTML', content: input.html },
          toRecipients: [{ emailAddress: { address: input.to } }],
          attachments: (input.attachments || []).map((attachment) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: attachment.name,
            contentType: attachment.contentType,
            contentBytes: attachment.contentBytes,
          })),
        },
        saveToSentItems: false,
      });
      return { sent: true };
    } catch (err) {
      this.logger.error('Graph sendMail failed', err as any);
      return { sent: false, error: (err as Error).message };
    }
  }
}
