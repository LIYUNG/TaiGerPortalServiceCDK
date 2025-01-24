import { Secret, SecretAttributes } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
// import { AWS_ACCOUNT } from '../configuration';

export interface SecretProps {
    //   stageName: string;
    //   isProd: boolean;
    // region: string;
    secretArn: string;
    //   mongoDBName: string;
    //   externalS3BucketName: string;
    //   internalMongodbS3BucketName: string;
    //   origin: string;
}

export class SecretConstruct extends Construct {
    public readonly secrets: SecretAttributes;
    // public readonly API_ORIGIN: string;
    // public readonly HTTPS_PORT: string;
    // public readonly JWT_EXPIRE: string;
    // public readonly JWT_SECRET: string;
    // public readonly MONGODB_URI: string;
    // public readonly PORT: string;
    // public readonly PROGRAMS_CACHE: string;
    // public readonly ESCALATION_DEADLINE_DAYS_TRIGGER: string;
    // public readonly SMTP_HOST: string;
    // public readonly SMTP_PORT: string;
    // public readonly SMTP_USERNAME: string;
    // public readonly SMTP_PASSWORD: string;
    // public readonly ORIGIN: string;
    // public readonly CLEAN_UP_SCHEDULE: string;
    // public readonly WEEKLY_TASKS_REMINDER_SCHEDULE: string;
    // public readonly DAILY_TASKS_REMINDER_SCHEDULE: string;
    // public readonly COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE: string;
    // public readonly COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE: string;
    // public readonly COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE: string;
    // public readonly COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE: string;
    // public readonly UPLOAD_PATH: string;
    // public readonly AWS_S3_PUBLIC_BUCKET: string;
    // public readonly AWS_S3_PUBLIC_BUCKET_NAME: string;
    // public readonly AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT: string;
    // public readonly AWS_S3_BUCKET_NAME: string;
    // public readonly AWS_REGION: string;
    // public readonly OPENAI_API_KEY: string;

    constructor(scope: Construct, id: string, props: SecretProps) {
        super(scope, id);

        this.secrets = Secret.fromSecretCompleteArn(this, `Secret`, `${props.secretArn}`);
        // Step 2: Extract specific secrets from JSON

        // this.API_ORIGIN = secret.secretValueFromJson('API_ORIGIN').toString();
        // this.HTTPS_PORT = secret.secretValueFromJson('HTTPS_PORT').toString();
        // this.JWT_EXPIRE = secret.secretValueFromJson('JWT_EXPIRE').toString();
        // this.JWT_SECRET = secret.secretValueFromJson('JWT_SECRET').toString();
        // this.MONGODB_URI = secret.secretValueFromJson('MONGODB_URI').toString();
        // this.PORT = secret.secretValueFromJson('PORT').toString();

        // this.PROGRAMS_CACHE = secret
        //   .secretValueFromJson('PROGRAMS_CACHE')
        //   .toString();
        // this.ESCALATION_DEADLINE_DAYS_TRIGGER = secret
        //   .secretValueFromJson('ESCALATION_DEADLINE_DAYS_TRIGGER')
        //   .toString();
        // this.SMTP_HOST = secret.secretValueFromJson('SMTP_HOST').toString();
        // this.SMTP_PORT = secret.secretValueFromJson('SMTP_PORT').toString();
        // this.SMTP_USERNAME = secret.secretValueFromJson('SMTP_USERNAME').toString();
        // this.SMTP_PASSWORD = secret.secretValueFromJson('SMTP_PASSWORD').toString();
        // this.ORIGIN = secret.secretValueFromJson('ORIGIN').toString();
        // this.CLEAN_UP_SCHEDULE = secret
        //   .secretValueFromJson('CLEAN_UP_SCHEDULE')
        //   .toString();
        // this.WEEKLY_TASKS_REMINDER_SCHEDULE = secret
        //   .secretValueFromJson('WEEKLY_TASKS_REMINDER_SCHEDULE')
        //   .toString();
        // this.DAILY_TASKS_REMINDER_SCHEDULE = secret
        //   .secretValueFromJson('DAILY_TASKS_REMINDER_SCHEDULE')
        //   .toString();
        // this.COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE = secret
        //   .secretValueFromJson('COURSE_SELECTION_TASKS_REMINDER_JUNE_SCHEDULE')
        //   .toString();

        // this.COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE = secret
        //   .secretValueFromJson('COURSE_SELECTION_TASKS_REMINDER_JULY_SCHEDULE')
        //   .toString();
        // this.COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE = secret
        //   .secretValueFromJson('COURSE_SELECTION_TASKS_REMINDER_NOVEMBER_SCHEDULE')
        //   .toString();

        // this.COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE = secret
        //   .secretValueFromJson('COURSE_SELECTION_TASKS_REMINDER_DECEMBER_SCHEDULE')
        //   .toString();
        // this.UPLOAD_PATH = secret.secretValueFromJson('UPLOAD_PATH').toString();
        // this.AWS_S3_PUBLIC_BUCKET = secret
        //   .secretValueFromJson('UPLOAD_PATH')
        //   .toString();
        // this.AWS_S3_PUBLIC_BUCKET_NAME = secret
        //   .secretValueFromJson('AWS_S3_PUBLIC_BUCKET_NAME')
        //   .toString();
        // this.AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT = secret
        //   .secretValueFromJson('AWS_S3_DATAPIPELINE_TENFOLDAI_SNAPSHOT')
        //   .toString();

        // this.AWS_S3_BUCKET_NAME = secret
        //   .secretValueFromJson('AWS_S3_BUCKET_NAME')
        //   .toString();

        // this.AWS_REGION = secret.secretValueFromJson('AWS_REGION').toString();
        // this.OPENAI_API_KEY = secret
        //   .secretValueFromJson('OPENAI_API_KEY')
        //   .toString();
    }
}
