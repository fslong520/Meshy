/**
 * Zod → JSON Schema 简易转换器
 *
 * 将 Zod Schema 转为 LLM Tool Call 所需的 JSON Schema 格式。
 * 使用 Zod 内部 _def 结构进行类型推断，兼容 Zod v3/v4。
 */

import { z } from 'zod';

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
    return convertZodType(schema);
}

function convertZodType(schema: z.ZodType): Record<string, unknown> {
    const def = (schema as any)._def ?? (schema as any).def;
    if (!def) return { type: 'string' };

    const typeName: string = def.typeName ?? def.type ?? '';

    switch (typeName) {
        case 'ZodObject': {
            const shape = (schema as z.ZodObject<any>).shape;
            const properties: Record<string, unknown> = {};
            const required: string[] = [];

            for (const [key, value] of Object.entries(shape)) {
                const fieldSchema = value as z.ZodType;
                properties[key] = convertZodType(fieldSchema);

                const fieldDef = (fieldSchema as any)._def ?? (fieldSchema as any).def;
                const fieldTypeName: string = fieldDef?.typeName ?? fieldDef?.type ?? '';
                if (fieldTypeName !== 'ZodOptional') {
                    required.push(key);
                }
            }

            return {
                type: 'object',
                properties,
                ...(required.length > 0 ? { required } : {}),
            };
        }

        case 'ZodString':
            return {
                type: 'string',
                ...(schema.description ? { description: schema.description } : {}),
            };

        case 'ZodNumber':
            return {
                type: 'number',
                ...(schema.description ? { description: schema.description } : {}),
            };

        case 'ZodBoolean':
            return {
                type: 'boolean',
                ...(schema.description ? { description: schema.description } : {}),
            };

        case 'ZodOptional': {
            // 解包内部类型
            const innerType = def.innerType ?? def.type;
            if (innerType) return convertZodType(innerType);
            return { type: 'string' };
        }

        case 'ZodDefault': {
            const innerType = def.innerType ?? def.type;
            if (innerType) return convertZodType(innerType);
            return { type: 'string' };
        }

        case 'ZodArray': {
            const elementType = def.type ?? def.element;
            return {
                type: 'array',
                ...(elementType ? { items: convertZodType(elementType) } : {}),
                ...(schema.description ? { description: schema.description } : {}),
            };
        }

        case 'ZodEnum':
            return {
                type: 'string',
                enum: def.values,
                ...(schema.description ? { description: schema.description } : {}),
            };

        default:
            return { type: 'string' };
    }
}
