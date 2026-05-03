import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { aws_rds, aws_ec2, aws_secretsmanager, Duration } from "aws-cdk-lib";
import { APPLICATION_NAME } from "../configuration";

interface DbStackProps extends cdk.StackProps {
    stageName: string;
    isProd: boolean;
    vpc: aws_ec2.Vpc;
}

export class DbStack extends cdk.Stack {
    readonly database: aws_rds.DatabaseInstance;
    readonly dbSecret: aws_secretsmanager.Secret;
    readonly dbSecurityGroup: aws_ec2.SecurityGroup;

    constructor(scope: Construct, id: string, props: DbStackProps) {
        super(scope, id, props);

        // Create security group for RDS
        this.dbSecurityGroup = new aws_ec2.SecurityGroup(
            this,
            `${APPLICATION_NAME}-db-sg-${props.stageName}`,
            {
                vpc: props.vpc,
                description: `${APPLICATION_NAME} RDS Security Group`,
                allowAllOutbound: false
            }
        );

        // Allow PostgreSQL access from the same VPC
        this.dbSecurityGroup.addIngressRule(
            aws_ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
            aws_ec2.Port.tcp(5432),
            "Allow PostgreSQL from VPC"
        );

        // Create RDS Subnet Group
        const subnetGroup = new aws_rds.SubnetGroup(
            this,
            `${APPLICATION_NAME}-db-subnet-group-${props.stageName}`,
            {
                vpc: props.vpc,
                vpcSubnets: {
                    subnetType: aws_ec2.SubnetType.PRIVATE_ISOLATED
                },
                description: `${APPLICATION_NAME} DB Subnet Group`,
                removalPolicy: cdk.RemovalPolicy.DESTROY
            }
        );

        // Generate secure password
        const passwordSecret = new aws_secretsmanager.Secret(
            this,
            `${APPLICATION_NAME}-db-password-${props.stageName}`,
            {
                generateSecretString: {
                    secretStringTemplate: JSON.stringify({ username: "postgres" }),
                    generateStringKey: "password",
                    excludeCharacters: '"@/\\',
                    passwordLength: 30
                },
                removalPolicy: cdk.RemovalPolicy.DESTROY
            }
        );

        const dbPassword = passwordSecret.secretValueFromJson("password");

        // Store the complete secret (used for app connection)
        this.dbSecret = new aws_secretsmanager.Secret(
            this,
            `${APPLICATION_NAME}-db-secret-${props.stageName}`,
            {
                removalPolicy: cdk.RemovalPolicy.DESTROY
            }
        );

        // Create RDS PostgreSQL instance (cheapest option)
        this.database = new aws_rds.DatabaseInstance(
            this,
            `${APPLICATION_NAME}-postgres-${props.stageName}`,
            {
                engine: aws_rds.DatabaseInstanceEngine.postgres({
                    version: aws_rds.PostgresEngineVersion.VER_15_3
                }),
                instanceType: aws_ec2.InstanceType.of(
                    aws_ec2.InstanceClass.BURSTABLE3,
                    aws_ec2.InstanceSize.MICRO // t3.micro - cheapest
                ),
                allocatedStorage: 20, // Minimum 20 GB
                storageType: aws_rds.StorageType.GP2,
                credentials: aws_rds.Credentials.fromPassword("postgres", dbPassword),
                databaseName: "taigerdb",
                vpc: props.vpc,
                vpcSubnets: {
                    subnetType: aws_ec2.SubnetType.PRIVATE_ISOLATED
                },
                subnetGroup,
                securityGroups: [this.dbSecurityGroup],
                multiAz: props.isProd, // High availability only for prod
                backupRetention: props.isProd ? Duration.days(30) : Duration.days(7),
                deletionProtection: props.isProd,
                removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
                autoMinorVersionUpgrade: true,
                cloudwatchLogsExports: ["postgresql"],
                iamAuthentication: true, // Support IAM auth
                storageEncryptionKey: undefined // Use default AWS managed key for cost
            }
        );

        // Store the complete connection secret
        new aws_secretsmanager.Secret(
            this,
            `${APPLICATION_NAME}-db-connection-secret-${props.stageName}`,
            {
                secretObjectValue: {
                    host: cdk.SecretValue.unsafePlainText(this.database.instanceEndpoint.hostname),
                    port: cdk.SecretValue.unsafePlainText(
                        this.database.instanceEndpoint.port.toString()
                    ),
                    username: cdk.SecretValue.unsafePlainText("postgres"),
                    password: dbPassword,
                    engine: cdk.SecretValue.unsafePlainText("postgres"),
                    dbname: cdk.SecretValue.unsafePlainText("taigerdb")
                },
                removalPolicy: cdk.RemovalPolicy.DESTROY
            }
        );

        // Outputs
        new cdk.CfnOutput(this, "DatabaseEndpoint", {
            value: this.database.instanceEndpoint.hostname,
            description: "RDS Database Endpoint"
        });

        new cdk.CfnOutput(this, "DatabasePort", {
            value: this.database.instanceEndpoint.port.toString(),
            description: "RDS Database Port"
        });

        new cdk.CfnOutput(this, "DatabaseName", {
            value: "taigerdb",
            description: "RDS Database Name"
        });

        new cdk.CfnOutput(this, "SecretArn", {
            value: this.dbSecret.secretArn,
            description: "RDS Secret ARN for connection details"
        });

        new cdk.CfnOutput(this, "VpcId", {
            value: props.vpc.vpcId,
            description: "VPC ID for RDS"
        });
    }
}
