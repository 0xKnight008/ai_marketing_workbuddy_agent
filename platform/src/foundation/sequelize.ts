import { DataTypes, Model, Sequelize, type Transaction } from 'sequelize';

export interface PendingApprovalView {
  id: string;
  runId: string;
  requestedAction: Record<string, unknown>;
  requestedAt: Date;
}

interface ApprovalRequestAttributes extends PendingApprovalView {
  workspaceId: string;
  status: 'pending' | 'approved' | 'rejected';
}

class ApprovalRequest extends Model<ApprovalRequestAttributes> implements ApprovalRequestAttributes {
  declare id: string;
  declare workspaceId: string;
  declare runId: string;
  declare status: 'pending' | 'approved' | 'rejected';
  declare requestedAction: Record<string, unknown>;
  declare requestedAt: Date;
}

/**
 * ORM boundary for read/write models that are being moved off raw SQL. Every
 * tenant operation must set the RLS workspace variable inside the same
 * Sequelize transaction before accessing a model.
 */
export class PlatformOrm {
  readonly sequelize: Sequelize;
  readonly approvalRequest: typeof ApprovalRequest;

  constructor(databaseUrl: string) {
    this.sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      pool: { max: 10, min: 0, idle: 10_000 },
    });
    this.approvalRequest = ApprovalRequest.init({
      id: { type: DataTypes.UUID, primaryKey: true },
      workspaceId: { type: DataTypes.UUID, allowNull: false, field: 'workspace_id' },
      runId: { type: DataTypes.UUID, allowNull: false, field: 'run_id' },
      status: { type: DataTypes.ENUM('pending', 'approved', 'rejected'), allowNull: false },
      requestedAction: { type: DataTypes.JSONB, allowNull: false, field: 'requested_action' },
      requestedAt: { type: DataTypes.DATE, allowNull: false, field: 'requested_at' },
    }, {
      sequelize: this.sequelize,
      tableName: 'approval_request',
      timestamps: false,
    });
  }

  async pendingApprovals(workspaceId: string): Promise<PendingApprovalView[]> {
    return this.withWorkspace(workspaceId, (transaction) => this.approvalRequest.findAll({
      attributes: ['id', 'runId', 'requestedAction', 'requestedAt'],
      where: { workspaceId, status: 'pending' },
      order: [['requestedAt', 'ASC']],
      limit: 100,
      transaction,
      raw: true,
    })) as Promise<PendingApprovalView[]>;
  }

  async withWorkspace<T>(workspaceId: string, operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(async (transaction) => {
      await this.sequelize.query("SELECT set_config('app.workspace_id', :workspaceId, true)", {
        replacements: { workspaceId },
        transaction,
      });
      return operation(transaction);
    });
  }

  async close(): Promise<void> { await this.sequelize.close(); }
}
