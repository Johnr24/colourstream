import { ApiResponse } from '../types';
import {
  Client,
  Project,
  UploadLink,
  UploadedFile,
  CreateClientRequest,
  CreateProjectRequest,
  CreateUploadLinkRequest,
} from '../types/upload';
import { api } from '../utils/api';

// Client Management
export const getClients = async (): Promise<ApiResponse<Client[]>> => {
  const response = await api.get('/upload/clients');
  return response.data;
};

export const createClient = async (data: CreateClientRequest): Promise<ApiResponse<Client>> => {
  const response = await api.post('/upload/clients', data);
  return response.data;
};

export const updateClient = async (clientId: string, name: string): Promise<ApiResponse<Client>> => {
  const response = await api.put(`/upload/clients/${clientId}`, { name });
  return response.data;
};

export const deleteClient = async (clientId: string): Promise<ApiResponse<void>> => {
  const response = await api.delete(`/upload/clients/${clientId}`);
  return response.data;
};

// Project Management
export const getClientProjects = async (clientId: string): Promise<ApiResponse<Project[]>> => {
  const response = await api.get(`/upload/clients/${clientId}/projects`);
  return response.data;
};

export const getAllProjects = async (): Promise<ApiResponse<Project[]>> => {
  const response = await api.get('/upload/projects');
  return response.data;
};

export const createProject = async (
  clientId: string,
  data: CreateProjectRequest
): Promise<ApiResponse<Project>> => {
  const response = await api.post(`/upload/clients/${clientId}/projects`, data);
  return response.data;
};

export const deleteProject = async (projectId: string): Promise<ApiResponse<void>> => {
  const response = await api.delete(`/upload/projects/${projectId}`);
  return response.data;
};

export const updateProject = async (
  projectId: string, 
  data: { name?: string; description?: string }
): Promise<ApiResponse<Project>> => {
  const response = await api.put(`/upload/projects/${projectId}`, data);
  return response.data;
};

export const getProject = async (projectId: string): Promise<ApiResponse<Project>> => {
  const response = await api.get(`/upload/projects/${projectId}`);
  return response.data;
};

// Upload Link Management
export const createUploadLink = async (
  projectId: string,
  data: CreateUploadLinkRequest
): Promise<ApiResponse<UploadLink>> => {
  const response = await api.post(`/upload/projects/${projectId}/upload-links`, data);
  return response.data;
};

export const getUploadLink = async (token: string): Promise<ApiResponse<UploadLink>> => {
  const response = await api.get(`/upload/upload-links/${token}`);
  return response.data;
};

export const deleteUploadLink = async (linkId: string): Promise<ApiResponse<void>> => {
  const response = await api.delete(`/upload/upload-links/${linkId}`);
  return response.data;
};

export const updateUploadLink = async (
  linkId: string,
  data: { expiresAt?: string; maxUses?: number | null }
): Promise<ApiResponse<UploadLink>> => {
  const response = await api.put(`/upload/upload-links/${linkId}`, data);
  return response.data;
};

export const getAllUploadLinks = async (): Promise<ApiResponse<UploadLink[]>> => {
  try {
    const response = await api.get('/upload/upload-links-all');
    return response.data;
  } catch (error: any) {
    console.error('Error fetching upload links:', error);
    return {
      status: 'error',
      message: error.response?.data?.message || 'Failed to fetch upload links',
      data: [] as UploadLink[]
    };
  }
};

// File Management
export const getProjectFiles = async (projectId: string): Promise<ApiResponse<UploadedFile[]>> => {
  const response = await api.get(`/upload/projects/${projectId}/files`);
  return response.data;
};

export const downloadFile = async (fileId: string): Promise<Blob> => {
  const response = await api.get(`/upload/files/${fileId}/download`, {
    responseType: 'blob'
  });
  return response.data;
};

// Turbosort Management
export const setTurbosortDirectory = async (
  projectId: string,
  directory: string
): Promise<ApiResponse<{ directory: string }>> => {
  const response = await api.post(`/upload/projects/${projectId}/turbosort`, { directory });
  return response.data;
};

export const deleteTurbosortDirectory = async (
  projectId: string
): Promise<ApiResponse<{ message: string }>> => {
  const response = await api.delete(`/upload/projects/${projectId}/turbosort`);
  return response.data;
}; 
