import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@microsoft/microsoft-graph-client';
import { ConfidentialClientApplication } from '@azure/msal-node';

interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);
  private msalClient?: ConfidentialClientApplication;

  constructor() {
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const tenantId = process.env.AZURE_TENANT_ID;
    if (clientId && clientSecret && tenantId) {
      this.msalClient = new ConfidentialClientApplication({
        auth: {
          clientId,
          clientSecret,
          authority: `https://login.microsoftonline.com/${tenantId}`,
        },
      });
    }
  }

  private async getToken() {
    if (!this.msalClient) throw new Error('Microsoft Graph is not configured');
    const token = await this.msalClient.acquireTokenByClientCredential({
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
