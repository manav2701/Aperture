import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
} from 'n8n-workflow';

export class ApertureAgent implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Aperture AI Agent Policy',
    name: 'apertureAgent',
    icon: 'file:aperture.svg',
    group: ['transform'],
    version: 1,
    description: 'Manage Aperture Solana AI agent wallet spending policies and approvals',
    defaults: {
      name: 'Aperture Agent Policy',
    },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Approve / Deny Transaction', value: 'approveTransaction' },
          { name: 'Create Agent Policy', value: 'createPolicy' },
          { name: 'Get Spend Summary', value: 'getSpendSummary' },
          { name: 'List Pending Approvals', value: 'listApprovals' },
          { name: 'Pause / Resume Agent', value: 'pauseAgent' },
          { name: 'Trigger Session', value: 'triggerSession' },
          { name: 'Update Policy Limits', value: 'updateLimits' },
        ],
        default: 'createPolicy',
      },
      {
        displayName: 'Agent Address',
        name: 'agentAddress',
        type: 'string',
        default: '',
        placeholder: 'Solana Public Key',
        required: true,
        displayOptions: {
          show: {
            operation: ['createPolicy', 'updateLimits', 'pauseAgent', 'triggerSession'],
          },
        },
      },
      {
        displayName: 'Daily Limit (SOL)',
        name: 'dailyLimitSol',
        type: 'number',
        default: 100,
        displayOptions: {
          show: {
            operation: ['createPolicy', 'updateLimits'],
          },
        },
      },
      {
        displayName: 'Approval ID',
        name: 'approvalId',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['approveTransaction'],
          },
        },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const operation = this.getNodeParameter('operation', i) as string;

      let resultData: any = {};

      if (operation === 'createPolicy') {
        const agentAddress = this.getNodeParameter('agentAddress', i) as string;
        const dailyLimitSol = this.getNodeParameter('dailyLimitSol', i) as number;
        resultData = {
          success: true,
          action: 'CREATE_POLICY',
          agentAddress,
          dailyLimitSol,
          policyPDA: 'DerivedPolicyPDA...',
        };
      } else if (operation === 'approveTransaction') {
        const approvalId = this.getNodeParameter('approvalId', i) as string;
        resultData = {
          success: true,
          action: 'APPROVE_TRANSACTION',
          approvalId,
          status: 'APPROVED',
        };
      } else if (operation === 'getSpendSummary') {
        resultData = {
          success: true,
          dailySpentSol: 120.5,
          globalDailyCapSol: 1000.0,
          activeAgentsCount: 5,
        };
      } else {
        resultData = {
          success: true,
          operation,
          timestamp: new Date().toISOString(),
        };
      }

      returnData.push({ json: resultData });
    }

    return [returnData];
  }
}
